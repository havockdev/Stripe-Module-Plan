declare module "@workspace/stripe-checkout" {
  export interface ResultadoPagamento {
    sucesso: boolean;
    status: "paid" | "card_declined" | "error";
    mensagem: string;
  }

  export interface OpcoesPagamento {
    codigos?: string[];
    proxy?: string;
    cartao: {
      numero: string;
      cvv: string;
      mesVencimento: string;
      anoVencimento: string;
    };
    endereco: {
      nome: string;
      email: string;
      pais: string;
      rua: string;
      cidade: string;
      estado: string;
      cep: string;
    };
  }

  export function processarPagamento(
    link: string,
    opcoes: OpcoesPagamento,
  ): Promise<ResultadoPagamento>;
}
