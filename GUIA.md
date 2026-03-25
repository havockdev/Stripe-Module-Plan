# Guia de Uso — Stripe Billing Bot

## O que é este bot?

Este bot automatiza a troca de plano de assinatura no portal de cobrança do Stripe (Billing Portal), replicando exatamente o que um usuário faria manualmente ao clicar em "Confirmar mudança de plano". Ele executa 3 etapas em sequência, a partir de um link de sessão do portal.

---

## Como funciona o fluxo

O Stripe Billing Portal funciona assim por trás dos panos:

1. A aplicação (ex: Lovable.dev) gera um link de sessão do portal para o usuário
2. O usuário abre o link, navega até a tela de confirmação de mudança de plano
3. O portal exibe um resumo do novo plano e aguarda o clique em "Confirmar"
4. Ao confirmar, o Stripe atualiza a assinatura imediatamente

**O bot automatiza o passo 3 e 4**: dado o link de sessão e o ID do novo plano, ele confirma a mudança sem interação humana.

---

## As 3 etapas internas

### Etapa 1 — Extrair tokens da sessão

O bot acessa o link do portal como um navegador, analisa o HTML da página e extrai:

| Dado extraído | Para que serve |
|---|---|
| `Bearer token` (Authorization) | Autenticar todas as chamadas à API do Stripe |
| `Stripe-Account` | Identificar a conta Stripe do merchant |
| `X-Stripe-Manage-Client-Revision` | Versão do cliente (obrigatório pelo Stripe) |
| `Stripe-Version` | Versão da API do Stripe |
| `X-Stripe-Csrf-Token` | Token anti-CSRF para as requisições POST |
| `sessionId` (bps_...) | ID da sessão do billing portal |
| `sessionUrl` | URL base da sessão (usada no Referer das próximas chamadas) |
| `livemode` | Se é ambiente de produção (`true`) ou teste (`false`) |

### Etapa 2 — Ler o estado da sessão

Com os tokens da Etapa 1, o bot faz uma chamada GET à API interna do Stripe para obter o estado completo da sessão. Os dados mais importantes retornados são:

| Dado | O que significa |
|---|---|
| `flow.type` | Tipo do fluxo. Para troca de plano será `subscription_update_confirm` |
| `flow.subscriptionId` | ID da assinatura (`sub_...`) que será alterada |
| `flow.recurringItems[0].id` | ID do item da assinatura (`si_...`) que será trocado |
| `flow.recurringItems[0].price` | **ID do plano alvo** — o plano para onde a assinatura vai mudar |
| `availableProducts` | Lista completa de todos os planos disponíveis com seus preços |

> **Importante:** No fluxo `subscription_update_confirm`, o campo `recurringItems[0].price` representa o **plano de destino** (o novo plano), não o plano atual. Isso é padrão do Stripe — quando o usuário está na tela de confirmação, o portal já mostra o estado futuro da assinatura.

### Etapa 3 — Confirmar a troca de plano

O bot envia um POST à API interna do Stripe confirmando a troca. O corpo da requisição contém:

```
recurring_items[0][id]       = si_... (ID do item da assinatura, do Step 2)
recurring_items[0][quantity] = 1
recurring_items[0][price]    = price_... (ID do novo plano — targetPriceId)
```

A resposta do Stripe confirma a assinatura atualizada com:
- `status`: estado da assinatura (ex: `active`)
- `pendingUpdate`: se `null`, a mudança foi aplicada imediatamente
- `latestInvoice`: dados da última fatura gerada
- `defaultPaymentMethod`: método de pagamento utilizado

---

## Endpoints disponíveis

O servidor roda em `http://localhost:{PORT}` e todas as rotas ficam sob `/api/stripe/`.

---

### `POST /api/stripe/flow/full`
**O endpoint principal — use este na maioria dos casos.**

Executa as 3 etapas automaticamente em sequência e retorna tudo.

**Corpo da requisição:**
```json
{
  "url": "https://billing.stripe.com/p/session/live_.../flow",
  "targetPriceId": "price_..."
}
```

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `url` | string | Sim | Link de sessão do billing portal gerado pela sua aplicação |
| `targetPriceId` | string | Sim | ID do preço Stripe para o qual a assinatura deve ser trocada |

**Resposta:**
```json
{
  "step1": { ... dados dos tokens extraídos ... },
  "step2": { ... estado da sessão ... },
  "step3": {
    "subscriptionId": "sub_...",
    "status": "active",
    "pendingUpdate": null,
    "latestInvoice": {
      "id": "in_...",
      "status": "paid",
      "paymentIntentId": null,
      "paymentIntentStatus": null,
      "paymentIntentClientSecret": null
    },
    "defaultPaymentMethod": {
      "id": "pm_...",
      "type": "card",
      "brand": "mastercard",
      "last4": "9890",
      "expMonth": 5,
      "expYear": 2030,
      "funding": "credit",
      "wallet": null,
      "networks": null
    },
    "raw": { ... resposta JSON completa do Stripe ... }
  }
}
```

---

### `POST /api/stripe/flow/step1-2`
Executa apenas as etapas 1 e 2 (leitura, sem modificar nada). Útil para **inspecionar a sessão** antes de confirmar a troca.

**Corpo:**
```json
{
  "url": "https://billing.stripe.com/p/session/live_.../flow"
}
```

**Resposta:** `{ "step1": {...}, "step2": {...} }`

---

### `POST /api/stripe/step1`
Executa apenas a Etapa 1 — extrai tokens do HTML.

**Corpo:** `{ "url": "https://billing.stripe.com/p/session/live_.../flow" }`

---

### `POST /api/stripe/step2`
Executa apenas a Etapa 2 — lê o estado da sessão. Requer o resultado do Step 1 como corpo.

**Corpo:** `{ ...resultado completo do step1... }`

---

### `POST /api/stripe/step3`
Executa apenas a Etapa 3 — confirma a troca. Requer os resultados do Step 1 e Step 2.

**Corpo:**
```json
{
  "step1": { ...resultado do step1... },
  "step2": { ...resultado do step2... },
  "targetPriceId": "price_..."
}
```

---

## Como descobrir o `targetPriceId`

Você tem duas opções:

### Opção 1 — Usar o `recurringItems[0].price` do Step 2
Quando o usuário já chegou na tela de confirmação do portal, o `recurringItems[0].price` do Step 2 **já contém o ID do plano alvo**. Você pode usar esse valor diretamente:

```bash
# Primeiro inspecione a sessão:
curl -X POST http://localhost:PORT/api/stripe/flow/step1-2 \
  -H 'Content-Type: application/json' \
  -d '{"url": "SEU_LINK_AQUI"}'

# Pegue o valor de: step2.flow.recurringItems[0].price
# Esse é o targetPriceId
```

### Opção 2 — Usar a lista de planos disponíveis
O Step 2 retorna `availableProducts` com todos os planos e seus IDs de preço:

```json
"availableProducts": [
  {
    "productName": "Lite",
    "prices": [
      { "id": "price_1SQSE8KvR4zlUMOUgIcRNEh1", "unitAmount": 500, "interval": "month" }
    ]
  },
  {
    "productName": "Pro 0",
    "prices": [
      { "id": "price_1SfJHYKvR4zlUMOUN4ABuaB4", "unitAmount": 500, "interval": "month" },
      { "id": "price_1SfJHYKvR4zlUMOUGHmwg6bZ", "unitAmount": 5000, "interval": "year" }
    ]
  }
]
```

---

## IDs de preço conhecidos (desta conta)

| Plano | Período | Price ID |
|---|---|---|
| Lite | Mensal | `price_1SQSE8KvR4zlUMOUgIcRNEh1` |
| Pro 0 | Mensal | `price_1SfJHYKvR4zlUMOUN4ABuaB4` |
| Pro 0 | Anual | `price_1SfJHYKvR4zlUMOUGHmwg6bZ` |
| Pro 1 | Mensal | `price_1RBcnxKvR4zlUMOUbuZoAFZ9` |
| Pro 1 | Anual | `price_1RnItgKvR4zlUMOUk8eTwAye` |
| Pro 2 | Mensal | `price_1RBcorKvR4zlUMOUkqlwJnGa` |
| Pro 2 | Anual | `price_1RnIujKvR4zlUMOUtoIYlDEX` |
| Pro 3 | Mensal | `price_1RBcp9KvR4zlUMOUkgLVEDwi` |
| Pro 4 | Mensal | `price_1RBcpSKvR4zlUMOUpleDbItK` |
| Business 1 | Mensal | `price_1RgMOdKvR4zlUMOUVsqPsi4l` |
| Business 1 | Anual | `price_1RnIYhKvR4zlUMOU81PfruiM` |
| Business 2 | Mensal | `price_1RgMObKvR4zlUMOUmzfCLZgG` |

*(Lista completa retornada pelo endpoint step1-2 em `step2.availableProducts`)*

---

## Exemplos práticos

### Exemplo 1 — Downgrade Pro 0 → Lite

```bash
curl -X POST http://localhost:PORT/api/stripe/flow/full \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://billing.stripe.com/p/session/live_SEU_TOKEN/flow",
    "targetPriceId": "price_1SQSE8KvR4zlUMOUgIcRNEh1"
  }'
```

### Exemplo 2 — Upgrade Lite → Pro 0

```bash
curl -X POST http://localhost:PORT/api/stripe/flow/full \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://billing.stripe.com/p/session/live_SEU_TOKEN/flow",
    "targetPriceId": "price_1SfJHYKvR4zlUMOUN4ABuaB4"
  }'
```

### Exemplo 3 — Inspecionar sessão sem confirmar

```bash
curl -X POST http://localhost:PORT/api/stripe/flow/step1-2 \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://billing.stripe.com/p/session/live_SEU_TOKEN/flow"}'
```

---

## Interpretando a resposta do Step 3

| Campo | O que indica |
|---|---|
| `status: "active"` | Assinatura ativa — mudança bem-sucedida |
| `pendingUpdate: null` | Mudança aplicada **imediatamente** (sem proration pendente) |
| `pendingUpdate: {...}` | Mudança agendada (só efetiva na próxima renovação) |
| `latestInvoice.status: "paid"` | Fatura quitada — cobrança ocorreu normalmente |
| `latestInvoice.paymentIntentId: null` | Nenhuma nova cobrança foi gerada (comum em downgrades — crédito compensou) |
| `latestInvoice.paymentIntentId: "pi_..."` | Houve cobrança — verifique `paymentIntentStatus` |

---

## Observações importantes

### Validade do link de sessão
Os links do billing portal têm validade limitada (geralmente algumas horas). Se você receber um erro como `Step 1 request failed: 404` ou a sessão retornar HTML em vez de JSON no Step 2, o link expirou — gere um novo link pela sua aplicação.

### O bot não escolhe o plano
O bot sempre recebe o `targetPriceId` de fora. Você deve saber para qual plano quer trocar antes de chamar o bot. Use o endpoint `step1-2` para listar os planos disponíveis se tiver dúvida.

### Direção da troca (upgrade vs downgrade)
O bot funciona exatamente da mesma forma para upgrade e downgrade. O link gerado pela sua aplicação já define o contexto da troca — você só precisa confirmar passando o `targetPriceId` correto.

### Sessão de único uso
Após o Step 3 ser executado com sucesso, a sessão do billing portal é consumida. Para fazer uma nova troca, um novo link deve ser gerado pela aplicação.
