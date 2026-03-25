import { Router, type IRouter, type Request, type Response } from "express";
import { processarPagamento } from "@workspace/stripe-checkout";

const router: IRouter = Router();

const DADOS_PAGAMENTO = {
  codigos: ["SYMPOSIUMPC20"],
  cartao: {
    numero: "5226261200293012",
    cvv: "237",
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

router.post("/checkout/processar", async (req: Request, res: Response) => {
  const { link } = req.body as { link?: string };

  if (!link || typeof link !== "string") {
    res.status(400).json({ error: "Campo 'link' ausente ou inválido no body da requisição" });
    return;
  }

  if (!link.startsWith("https://checkout.stripe.com/")) {
    res.status(400).json({ error: "O campo 'link' deve ser uma URL válida do Stripe Checkout" });
    return;
  }

  try {
    req.log.info({ url: link.split("#")[0] }, "Iniciando processamento de checkout");
    const resultado = await processarPagamento(link, DADOS_PAGAMENTO);
    req.log.info({ status: resultado.status, sucesso: resultado.sucesso }, "Checkout concluído");
    res.json(resultado);
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Erro ao processar checkout");
    res.status(500).json({ sucesso: false, status: "error", mensagem });
  }
});

export default router;
