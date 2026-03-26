/**
 * proxy-ezcaptcha.js
 *
 * Script proxy para repassar chamadas do Replit para api.ezcaptcha.com.
 * Rode na VPS com: node proxy-ezcaptcha.js
 *
 * Porta padrão: 4000 (configure com PORT=xxxx node proxy-ezcaptcha.js)
 */

const http = require('http');
const https = require('https');

const PORTA = process.env.PORT || 4000;
const EZCAPTCHA_HOST = 'api.ezcaptcha.com';

const servidor = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ erro: 'Apenas POST' }));
    return;
  }

  // Coleta o body da requisição recebida
  let corpo = '';
  req.on('data', (chunk) => { corpo += chunk; });
  req.on('end', () => {
    const opcoes = {
      hostname: EZCAPTCHA_HOST,
      port: 443,
      path: req.url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corpo),
      },
    };

    console.log(`[${new Date().toISOString()}] Repassando ${req.url} → ${EZCAPTCHA_HOST}${req.url}`);

    const requisicao = https.request(opcoes, (resposta) => {
      let respostaCorpo = '';
      resposta.on('data', (chunk) => { respostaCorpo += chunk; });
      resposta.on('end', () => {
        console.log(`[${new Date().toISOString()}] Resposta ${req.url}: status=${resposta.statusCode} corpo=${respostaCorpo.substring(0, 120)}`);
        res.writeHead(resposta.statusCode, { 'Content-Type': 'application/json' });
        res.end(respostaCorpo);
      });
    });

    requisicao.on('error', (err) => {
      console.error(`[${new Date().toISOString()}] Erro ao chamar ezcaptcha: ${err.message}`);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errorId: 1, errorDescription: `Proxy erro: ${err.message}` }));
    });

    requisicao.write(corpo);
    requisicao.end();
  });
});

servidor.listen(PORTA, () => {
  console.log(`Proxy ezcaptcha rodando na porta ${PORTA}`);
  console.log(`Replit deve configurar: EZCAPTCHA_PROXY_URL=http://<ip-da-vps>:${PORTA}`);
});
