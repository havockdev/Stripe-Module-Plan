/**
 * testar-ezcaptcha.js
 *
 * Testa conectividade e autenticação com a API do ezcaptcha.
 * Sem dependências — usa apenas Node.js nativo.
 *
 * Uso:
 *   node testar-ezcaptcha.js
 *   node testar-ezcaptcha.js MINHA_CHAVE_AQUI
 */

const https = require('https');

const CHAVE_API = process.argv[2] || '2473b7c391a540f7b82812884f07dbd5977479';

function post(caminho, dados) {
  return new Promise((resolve, reject) => {
    const corpo = JSON.stringify(dados);
    const opcoes = {
      hostname: 'api.ez-captcha.com',
      port: 443,
      path: caminho,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(corpo),
      },
      timeout: 10000,
    };

    const req = https.request(opcoes, (res) => {
      let resposta = '';
      res.on('data', (chunk) => { resposta += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, dados: JSON.parse(resposta) }); }
        catch (_) { resolve({ status: res.statusCode, dados: resposta }); }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout de 10s — sem resposta do servidor'));
    });

    req.on('error', (err) => reject(err));

    req.write(corpo);
    req.end();
  });
}

async function main() {
  console.log('=== Teste ezcaptcha ===');
  console.log(`Chave: ${CHAVE_API.substring(0, 8)}...`);
  console.log(`Servidor: api.ezcaptcha.com`);
  console.log('');

  // 1. Testa getBalance
  console.log('[1] Testando getBalance...');
  try {
    const resultado = await post('/getBalance', { clientKey: CHAVE_API });
    console.log(`    Status HTTP: ${resultado.status}`);
    console.log(`    Resposta: ${JSON.stringify(resultado.dados)}`);

    if (resultado.dados.errorId === 0) {
      console.log(`    ✓ Chave válida! Saldo: ${resultado.dados.balance}`);
    } else {
      console.log(`    ✗ Erro ${resultado.dados.errorId}: ${resultado.dados.errorDescription}`);
    }
  } catch (err) {
    console.log(`    ✗ Falha de conexão: ${err.message}`);
    console.log('');
    console.log('    Este servidor NÃO consegue acessar api.ezcaptcha.com.');
    process.exit(1);
  }

  console.log('');

  // 2. Testa createTask (tarefa de exemplo — vai falhar por URL inválida, mas confirma autenticação)
  console.log('[2] Testando createTask (validação de autenticação)...');
  try {
    const resultado = await post('/createTask', {
      clientKey: CHAVE_API,
      task: {
        type: 'HCaptchaTaskProxyless',
        websiteURL: 'https://checkout.stripe.com',
        websiteKey: 'c7faac4c-1cd7-4b1b-b2d4-42ba98d09c7a',
      },
    });
    console.log(`    Status HTTP: ${resultado.status}`);
    console.log(`    Resposta: ${JSON.stringify(resultado.dados)}`);

    if (resultado.dados.errorId === 0) {
      console.log(`    ✓ Tarefa criada! taskId: ${resultado.dados.taskId}`);
    } else {
      console.log(`    ! Erro ${resultado.dados.errorId}: ${resultado.dados.errorDescription}`);
    }
  } catch (err) {
    console.log(`    ✗ Falha de conexão: ${err.message}`);
  }

  console.log('');
  console.log('=== Teste concluído ===');
}

main();
