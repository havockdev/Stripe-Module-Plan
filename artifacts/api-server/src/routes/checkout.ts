import { Router, type IRouter, type Request, type Response } from "express";

// @ts-ignore — módulo JavaScript puro sem tipos declarados
import { processarPagamento } from "@workspace/stripe-checkout";

const router: IRouter = Router();

/**
 * POST /stripe/checkout
 *
 * Executa o fluxo completo de nova assinatura via Stripe Checkout.
 * Abre o link de checkout no Firefox headless, aplica cupom (opcional),
 * cria o método de pagamento e confirma a assinatura.
 *
 * Body (JSON):
 * {
 *   "link": "https://checkout.stripe.com/c/pay/cs_live_xxx...",
 *   "codigos": ["SYMPOSIUMPC20"],          // opcional
 *   "cartao": {
 *     "numero": "2233 4667 2019 9890",
 *     "cvv": "114",
 *     "mesVencimento": "05",
 *     "anoVencimento": "30"
 *   },
 *   "endereco": {
 *     "nome": "NOME COMPLETO",
 *     "email": "email@example.com",
 *     "pais": "BR",
 *     "rua": "Rua Exemplo",
 *     "cidade": "Campo Grande",
 *     "estado": "MS",
 *     "cep": "79042-470"
 *   }
 * }
 *
 * Resposta:
 * { "sucesso": true,  "status": "complete",      "mensagem": "Pagamento confirmado" }
 * { "sucesso": true,  "status": "card_declined",  "mensagem": "..." }
 * { "sucesso": false, "status": "error",          "mensagem": "..." }
 */
router.post("/stripe/checkout", async (req: Request, res: Response) => {
  const { link, codigos, cartao, endereco } = req.body as {
    link?: string;
    codigos?: string[];
    cartao?: {
      numero: string;
      cvv: string;
      mesVencimento: string;
      anoVencimento: string;
    };
    endereco?: {
      nome: string;
      email: string;
      pais: string;
      rua: string;
      cidade: string;
      estado: string;
      cep: string;
    };
  };

  if (!link || typeof link !== "string") {
    res.status(400).json({ error: "Campo 'link' obrigatório e deve ser string" });
    return;
  }

  if (!cartao || !cartao.numero || !cartao.cvv || !cartao.mesVencimento || !cartao.anoVencimento) {
    res.status(400).json({ error: "Campo 'cartao' obrigatório com numero, cvv, mesVencimento e anoVencimento" });
    return;
  }

  if (!endereco || !endereco.nome || !endereco.email || !endereco.pais) {
    res.status(400).json({ error: "Campo 'endereco' obrigatório com nome, email e pais" });
    return;
  }

  try {
    const resultado = await processarPagamento(link, {
      codigos: codigos ?? [],
      cartao,
      endereco,
    });
    res.json(resultado);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.log.error({ err }, "Checkout falhou");
    res.status(500).json({ error: message });
  }
});

export default router;
