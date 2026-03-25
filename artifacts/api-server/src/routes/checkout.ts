import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { OpcoesPagamento, ResultadoPagamento } from "@workspace/stripe-checkout";

const router: IRouter = Router();

// Lista de cartões — adicione novos conforme necessário.
const CARTOES: OpcoesPagamento["cartao"][] = [
  { numero: "4392674255290074", cvv: "887", mesVencimento: "08", anoVencimento: "29" },
  { numero: "5226261200293012", cvv: "237", mesVencimento: "03", anoVencimento: "34" },
  { numero: "5226269772380877", cvv: "922", mesVencimento: "03", anoVencimento: "34" },
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

// Índice do cartão atual — persiste entre requisições em memória.
// Só avança quando o pagamento falha; fica no mesmo se der sucesso.
let indiceCartaoAtual = 0;

type StatusJob = "processando" | "concluido" | "erro";

interface Job {
  status: StatusJob;
  resultado: ResultadoPagamento | null;
  criadoEm: number;
}

// Armazena os jobs em memória (TTL implícito via limpeza periódica)
const jobs = new Map<string, Job>();

// Remove jobs com mais de 30 minutos para evitar vazamento de memória
setInterval(() => {
  const limite = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs.entries()) {
    if (job.criadoEm < limite) jobs.delete(id);
  }
}, 5 * 60 * 1000);

/**
 * POST /api/checkout/processar
 * Inicia o processamento de pagamento em segundo plano e retorna um jobId imediatamente.
 * Usa o cartão do índice atual. Se falhar, avança o índice para o próximo (circular).
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

  const jobId = randomUUID();
  jobs.set(jobId, { status: "processando", resultado: null, criadoEm: Date.now() });

  // Captura o índice e o cartão no momento da requisição
  const indiceUsado = indiceCartaoAtual;
  const cartao = CARTOES[indiceUsado];

  req.log.info(
    { jobId, url: link.split("#")[0], cartaoFinal: cartao.numero.slice(-4), indice: indiceUsado },
    `Job de checkout criado — usando cartão ...${cartao.numero.slice(-4)} (índice ${indiceUsado})`
  );

  res.status(202).json({ jobId });

  // Inicia o processamento em segundo plano (não aguarda aqui)
  (async () => {
    try {
      const { processarPagamento } = await import("@workspace/stripe-checkout");

      const resultado = await processarPagamento(link, { ...DADOS_BASE, cartao });

      if (resultado.status !== "paid") {
        // Falhou — avança para o próximo cartão (circular)
        const proximoIndice = (indiceUsado + 1) % CARTOES.length;
        indiceCartaoAtual = proximoIndice;
        req.log.warn(
          { jobId, status: resultado.status, indiceUsado, proximoIndice, cartaoFinal: cartao.numero.slice(-4) },
          `Cartão ...${cartao.numero.slice(-4)} falhou (${resultado.status}) — próxima requisição usará índice ${proximoIndice} (...${CARTOES[proximoIndice].numero.slice(-4)})`
        );
      } else {
        req.log.info(
          { jobId, indiceUsado, cartaoFinal: cartao.numero.slice(-4) },
          `Pagamento aprovado com cartão ...${cartao.numero.slice(-4)} — índice mantido em ${indiceUsado}`
        );
      }

      jobs.set(jobId, { status: "concluido", resultado, criadoEm: Date.now() });
      req.log.info({ jobId, status: resultado.status }, "Job de checkout concluído");
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      req.log.error({ jobId, err }, "Erro no job de checkout");

      // Erro inesperado também avança o cartão
      const proximoIndice = (indiceUsado + 1) % CARTOES.length;
      indiceCartaoAtual = proximoIndice;
      req.log.warn(
        { jobId, indiceUsado, proximoIndice },
        `Erro inesperado — próxima requisição usará índice ${proximoIndice}`
      );

      jobs.set(jobId, {
        status: "concluido",
        resultado: { sucesso: false, status: "error", mensagem },
        criadoEm: Date.now(),
      });
    }
  })();
});

/**
 * GET /api/checkout/status/:jobId
 * Consulta o resultado de um job de checkout.
 * Enquanto estiver processando: { status: "processando" }
 * Quando concluído: { status: "concluido", resultado: { sucesso, status, mensagem } }
 * Job não encontrado: 404
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

  res.json({ status: "concluido", resultado: job.resultado });
});

export default router;
