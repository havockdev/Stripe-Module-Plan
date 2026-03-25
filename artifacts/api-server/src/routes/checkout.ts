import { Router, type IRouter, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import type { OpcoesPagamento, ResultadoPagamento } from "@workspace/stripe-checkout";

const router: IRouter = Router();

const DADOS_PAGAMENTO: OpcoesPagamento = {
  codigos: ["SYMPOSIUMPC20"],
  cartao: {
    numero: "5226269772380877",
    cvv: "922",
    mesVencimento: "03",
    anoVencimento: "34",
  },
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

  req.log.info({ jobId, url: link.split("#")[0] }, "Job de checkout criado");

  // Inicia o processamento em segundo plano (não aguarda aqui)
  (async () => {
    try {
      const { processarPagamento } = await import("@workspace/stripe-checkout");
      const resultado = await processarPagamento(link, DADOS_PAGAMENTO);
      jobs.set(jobId, { status: "concluido", resultado, criadoEm: Date.now() });
      req.log.info({ jobId, status: resultado.status }, "Job de checkout concluído");
    } catch (err) {
      const mensagem = err instanceof Error ? err.message : String(err);
      req.log.error({ jobId, err }, "Erro no job de checkout");
      jobs.set(jobId, {
        status: "concluido",
        resultado: { sucesso: false, status: "error", mensagem },
        criadoEm: Date.now(),
      });
    }
  })();

  res.status(202).json({ jobId });
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
