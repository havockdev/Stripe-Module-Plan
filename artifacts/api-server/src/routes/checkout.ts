import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type {
  OpcoesPagamento,
  ResultadoPagamento,
} from "@workspace/stripe-checkout";

const router: IRouter = Router();

// Lista de cartões — adicione novos conforme necessário.
const CARTOES: OpcoesPagamento["cartao"][] = [
  {
    numero: "5502094503434958",
    cvv: "963",
    mesVencimento: "03",
    anoVencimento: "34",
  },
  // { numero: "5226261200293012", cvv: "237", mesVencimento: "03", anoVencimento: "34" },
  // { numero: "5226269772380877", cvv: "922", mesVencimento: "03", anoVencimento: "34" },
];

const DADOS_BASE = {
  codigos: ["SYMPOSIUMPC20"],
  endereco: {
    nome: "JAIRO PIRES SILVA",
    email: "joaodeprelian@gmail.com",
    pais: "BR",
    rua: "Rua Assef Buainain",
    cidade: "Campo Grande",
    estado: "MS",
    cep: "79042-470",
  },
};

// ─── Controle de concorrência e saúde dos cartões ────────────────────────────

// Números dos cartões atualmente com um job em execução (mutex por cartão)
const cartoesBloqueados = new Set<string>();

// Contagem de recusas consecutivas por número de cartão (só card_declined conta)
const errosConsecutivos = new Map<string, number>();

// Limite de recusas consecutivas antes de remover o cartão
const LIMITE_ERROS = 10;

// Duração do cooldown para jobs com 3DS (ms)
const COOLDOWN_3DS_MS = 10 * 60 * 1000;

// Índice preferido para a próxima escolha de cartão (circular)
let indiceCartaoAtual = 0;

// Aguarda 2s — usado no polling de cartão livre
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Aguarda até encontrar um cartão livre, trava-o (mutex) atomicamente e o
 * retorna já bloqueado. O check e o lock ocorrem no mesmo bloco síncrono —
 * sem await entre eles — garantindo que nenhum outro job possa adquirir o
 * mesmo cartão antes do lock ser aplicado (JS é single-threaded).
 * Retorna null se CARTOES estiver vazio.
 */
async function aguardarETravarCartao(
  preferido: number,
): Promise<{ cartao: OpcoesPagamento["cartao"]; indice: number } | null> {
  while (true) {
    if (CARTOES.length === 0) return null;

    // Bloco SÍNCRONO: percorre e trava sem ceder o event loop
    const inicio = preferido % CARTOES.length;
    for (let offset = 0; offset < CARTOES.length; offset++) {
      const indice = (inicio + offset) % CARTOES.length;
      const cartao = CARTOES[indice];
      if (!cartoesBloqueados.has(cartao.numero)) {
        // Lock aplicado imediatamente — sem await entre o check e o add
        cartoesBloqueados.add(cartao.numero);
        return { cartao, indice };
      }
    }

    // Todos ocupados — aguarda e tenta novamente
    await sleep(2000);
  }
}

/**
 * Registra uma recusa consecutiva para o cartão. Remove o cartão da lista se
 * atingir o limite. Retorna true se o cartão foi removido.
 */
function registrarErroCartao(numero: string): boolean {
  const atual = (errosConsecutivos.get(numero) ?? 0) + 1;
  errosConsecutivos.set(numero, atual);

  if (atual >= LIMITE_ERROS) {
    const indiceRemovido = CARTOES.findIndex((c) => c.numero === numero);
    if (indiceRemovido !== -1) {
      CARTOES.splice(indiceRemovido, 1);
      errosConsecutivos.delete(numero);

      // Ajusta o índice atual para não ultrapassar o tamanho da lista
      if (CARTOES.length > 0) {
        indiceCartaoAtual = indiceCartaoAtual % CARTOES.length;
      } else {
        indiceCartaoAtual = 0;
      }
    }
    return true;
  }
  return false;
}

// ─── Jobs ─────────────────────────────────────────────────────────────────────

type StatusJob = "processando" | "cooldown" | "concluido";

interface Job {
  status: StatusJob;
  resultado: ResultadoPagamento | null;
  criadoEm: number;
  /** Timestamp Unix ms até quando o job fica em cooldown (só em status "cooldown") */
  cooldownAte?: number;
}

// Armazena os jobs em memória (TTL implícito via limpeza periódica)
const jobs = new Map<string, Job>();

// Remove jobs com mais de 30 minutos para evitar vazamento de memória
setInterval(
  () => {
    const limite = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of jobs.entries()) {
      if (job.criadoEm < limite) jobs.delete(id);
    }
  },
  5 * 60 * 1000,
);

// ─── Rotas ────────────────────────────────────────────────────────────────────

/**
 * POST /api/checkout/processar
 * Inicia o processamento de pagamento em segundo plano e retorna um jobId imediatamente.
 *
 * Comportamento do cartão:
 *  - Usa o cartão preferido (indiceCartaoAtual); se estiver ocupado, aguarda ou usa outro livre.
 *  - Máximo 1 job por cartão ao mesmo tempo (mutex).
 *  - Sucesso: mantém o cartão atual e zera o contador de recusas.
 *  - card_declined: penaliza o cartão (remove após 10 recusas consecutivas).
 *  - error (3DS, captcha, etc.): não penaliza o cartão; se for 3DS entra em cooldown.
 *
 * Body: { link: string }
 */
router.post("/checkout/processar", async (req: Request, res: Response) => {
  const { link } = req.body as { link?: string };

  if (!link || typeof link !== "string") {
    res.status(400).json({
      sucesso: false,
      status: "error",
      mensagem: "Campo 'link' ausente ou inválido no body da requisição",
    });
    return;
  }

  if (!link.startsWith("https://checkout.stripe.com/")) {
    res.status(400).json({
      sucesso: false,
      status: "error",
      mensagem: "O campo 'link' deve ser uma URL válida do Stripe Checkout",
    });
    return;
  }

  if (CARTOES.length === 0) {
    res.status(503).json({
      sucesso: false,
      status: "error",
      mensagem:
        "Nenhum cartão disponível — todos foram removidos por excesso de recusas",
    });
    return;
  }

  const jobId = randomUUID();
  jobs.set(jobId, {
    status: "processando",
    resultado: null,
    criadoEm: Date.now(),
  });

  req.log.info(
    {
      jobId,
      url: link.split("#")[0],
      cartoesBloqueados: [...cartoesBloqueados],
      totalCartoes: CARTOES.length,
    },
    "Job de checkout criado — aguardando cartão livre",
  );

  res.status(202).json({ jobId });

  // Processamento em segundo plano
  (async () => {
    // ── 1. Aguarda e trava um cartão livre (atomicamente) ──────────────────
    const obtido = await aguardarETravarCartao(indiceCartaoAtual);

    if (!obtido) {
      req.log.error({ jobId }, "Nenhum cartão disponível após espera");
      jobs.set(jobId, {
        status: "concluido",
        resultado: {
          sucesso: false,
          status: "error",
          mensagem:
            "Nenhum cartão disponível — todos foram removidos por excesso de recusas",
        },
        criadoEm: Date.now(),
      });
      return;
    }

    const { cartao, indice: indiceUsado } = obtido;
    // cartao já está bloqueado em cartoesBloqueados — lock foi aplicado dentro de aguardarETravarCartao

    req.log.info(
      {
        jobId,
        cartaoFinal: cartao.numero.slice(-4),
        indiceUsado,
        cartoesBloqueados: [...cartoesBloqueados],
      },
      `Cartão ...${cartao.numero.slice(-4)} adquirido — iniciando pagamento`,
    );

    let resultado: ResultadoPagamento;

    try {
      const { processarPagamento } = await import("@workspace/stripe-checkout");
      resultado = await processarPagamento(link, { ...DADOS_BASE, cartao });
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      req.log.error(
        { jobId, err },
        "Erro inesperado durante processarPagamento",
      );
      resultado = { sucesso: false, status: "error", mensagem };
    } finally {
      // ── 3. Libera o mutex sempre ────────────────────────────────────────
      cartoesBloqueados.delete(cartao.numero);
    }

    // ── 4. Atualiza estado do cartão com base no resultado ──────────────

    // Função auxiliar: avança o índice para o próximo cartão (circular)
    const avancarIndice = () => {
      if (CARTOES.length > 0) {
        const posAtual = CARTOES.findIndex((c) => c.numero === cartao.numero);
        indiceCartaoAtual =
          posAtual !== -1
            ? (posAtual + 1) % CARTOES.length
            : indiceCartaoAtual % CARTOES.length;
      }
    };

    if (resultado.status === "paid") {
      // Sucesso — zera o contador e mantém o cartão atual
      errosConsecutivos.set(cartao.numero, 0);
      indiceCartaoAtual = CARTOES.findIndex((c) => c.numero === cartao.numero);
      if (indiceCartaoAtual === -1) indiceCartaoAtual = 0;

      req.log.info(
        { jobId, cartaoFinal: cartao.numero.slice(-4), indiceUsado },
        `Pagamento aprovado com cartão ...${cartao.numero.slice(-4)} — índice mantido`,
      );
      jobs.set(jobId, { status: "concluido", resultado, criadoEm: Date.now() });
    } else if (resultado.status === "card_declined") {
      // Recusa do cartão — penaliza o cartão (pode remover após 10x)
      const foiRemovido = registrarErroCartao(cartao.numero);
      const erros = errosConsecutivos.get(cartao.numero) ?? LIMITE_ERROS;

      if (foiRemovido) {
        req.log.warn(
          {
            jobId,
            cartaoFinal: cartao.numero.slice(-4),
            totalCartoes: CARTOES.length,
          },
          `Cartão ...${cartao.numero.slice(-4)} removido após ${LIMITE_ERROS} recusas consecutivas — restam ${CARTOES.length} cartão(ões)`,
        );
      } else {
        avancarIndice();
        req.log.warn(
          {
            jobId,
            status: resultado.status,
            cartaoFinal: cartao.numero.slice(-4),
            errosConsecutivos: erros,
            proximoIndice: indiceCartaoAtual,
            proximoCartaoFinal: CARTOES[indiceCartaoAtual]?.numero.slice(-4),
          },
          `Cartão ...${cartao.numero.slice(-4)} recusado — recusas consecutivas: ${erros}/${LIMITE_ERROS} — próximo: ...${CARTOES[indiceCartaoAtual]?.numero.slice(-4)}`,
        );
      }
      jobs.set(jobId, { status: "concluido", resultado, criadoEm: Date.now() });
    } else {
      // Erro genérico — NÃO penaliza o cartão, apenas avança o índice.
      avancarIndice();

      // ── Detecção de 3DS: entra em cooldown ────────────────────────────
      const e3DS = resultado.mensagem?.includes("3DS");
      if (e3DS) {
        const cooldownAte = Date.now() + COOLDOWN_3DS_MS;
        req.log.warn(
          {
            jobId,
            cartaoFinal: cartao.numero.slice(-4),
            cooldownAte: new Date(cooldownAte).toISOString(),
            duracaoMin: COOLDOWN_3DS_MS / 60000,
          },
          `Job em cooldown de ${COOLDOWN_3DS_MS / 60000} minutos — conta exige 3DS`,
        );
        jobs.set(jobId, {
          status: "cooldown",
          resultado,
          criadoEm: Date.now(),
          cooldownAte,
        });
      } else {
        req.log.warn(
          {
            jobId,
            status: resultado.status,
            mensagem: resultado.mensagem,
            cartaoFinal: cartao.numero.slice(-4),
            proximoIndice: indiceCartaoAtual,
            proximoCartaoFinal: CARTOES[indiceCartaoAtual]?.numero.slice(-4),
          },
          `Cartão ...${cartao.numero.slice(-4)} — erro não-penalizante (${resultado.status}) — próximo índice: ${indiceCartaoAtual}`,
        );
        jobs.set(jobId, {
          status: "concluido",
          resultado,
          criadoEm: Date.now(),
        });
      }
    }

    req.log.info(
      {
        jobId,
        statusJob: jobs.get(jobId)?.status,
        statusResultado: resultado.status,
      },
      "Job de checkout finalizado",
    );
  })();
});

/**
 * GET /api/checkout/status/:jobId
 * Consulta o resultado de um job de checkout.
 *
 * Respostas possíveis:
 *  - { status: "processando" }                                  — automação ainda rodando
 *  - { status: "cooldown", aguardar: N }                        — 3DS detectado, aguardar N segundos
 *  - { status: "concluido", resultado: { sucesso, status, mensagem } } — finalizado
 *  - 404 se o job não existir ou tiver expirado
 */
router.get("/checkout/status/:jobId", (req: Request, res: Response) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    res.status(404).json({
      sucesso: false,
      status: "error",
      mensagem: `Job '${jobId}' não encontrado ou expirado`,
    });
    return;
  }

  if (job.status === "processando") {
    res.json({ status: "processando" });
    return;
  }

  if (job.status === "cooldown") {
    const agora = Date.now();
    if (agora < job.cooldownAte!) {
      const aguardar = Math.ceil((job.cooldownAte! - agora) / 1000);
      req.log.info(
        { jobId, aguardar },
        `Job em cooldown — ${aguardar}s restantes`,
      );
      res.json({ status: "cooldown", aguardar });
      return;
    }
    // Cooldown expirado — transiciona para concluido
    job.status = "concluido";
    jobs.set(jobId, job);
    req.log.info(
      { jobId },
      "Cooldown expirado — job transicionado para concluido",
    );
  }

  res.json({ status: "concluido", resultado: job.resultado });
});

export default router;
