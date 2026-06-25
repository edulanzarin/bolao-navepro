# Bolão NAVEPRO

Aplicação de bolão de palpites para a Copa 2026. Os participantes cravam o placar e respondem perguntas especiais (marcadores, faltas, escanteios, cartões); a pontuação é por proximidade e o ranking acumula entre as partidas.

Stack: Node.js + Express, SQLite (better-sqlite3), front estático (HTML/CSS/JS sem framework). Empacotado em Docker, sem dependência de banco externo.

## Funcionalidades

- Onboarding em 4 etapas (dados → placar → perguntas especiais → revisão).
- Identificação por **CPF/CNPJ** (com validação de dígito verificador). Um palpite por documento, por partida — sem alteração após o envio.
- Pontuação por proximidade: placar exato (12), resultado (5), saldo de gols (3), gols por equipe (1 cada) e as perguntas especiais (pontos próprios).
- Perguntas especiais configuráveis por partida (jogadores, número, múltipla escolha).
- Contador regressivo para o encerramento dos palpites; trava automática no prazo (fuso de Brasília).
- Ranking ao vivo, alternando entre geral e por jogo.
- Seleção automática do "jogo atual": ao encerrar uma partida, o site passa para a próxima cadastrada.
- Painel do organizador (`/admin.html`, protegido por senha): cadastrar/editar/excluir partidas, definir prazo, editar perguntas, lançar o resultado oficial (recalcula a pontuação), editar a premiação e consultar os contatos dos participantes.

## Desenvolvimento

Requer Node.js 18+.

```bash
npm install
ADMIN_PASSWORD=suasenha npm run dev
```

Aplicação em `http://localhost:3000` e painel em `http://localhost:3000/admin.html`.

## Docker

```bash
cp .env.example .env      # ajuste ADMIN_PASSWORD
docker compose up -d --build
```

O banco SQLite fica no volume `bolao-data` (`/app/data/bolao.db`) e persiste entre reinícios. Para parar: `docker compose down` (mantém os dados) ou `docker compose down -v` (apaga tudo).

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP da aplicação |
| `ADMIN_PASSWORD` | `navepro2026` | Senha do painel do organizador |
| `DATA_DIR` | `/app/data` | Diretório do banco SQLite |
| `TZ` | `America/Sao_Paulo` | Fuso usado nos prazos |
| `API_FOOTBALL_KEY` | — | (Opcional) Chave do API-Football para placar/estatísticas ao vivo. Sem ela, o resultado é lançado manualmente. |

## Publicação em subdomínio (ex.: bolao.dominio.com.br)

A aplicação escuta apenas em HTTP na porta 3000; o domínio e o HTTPS ficam a cargo de um reverse proxy.

1. Criar o registro DNS do subdomínio (`A`/`AAAA` ou `CNAME`) apontando para o servidor.
2. Subir o container no servidor: `docker compose up -d --build`.
3. Configurar o reverse proxy (exemplo em [`deploy/nginx-bolao.conf.example`](deploy/nginx-bolao.conf.example)) para encaminhar o subdomínio à porta 3000.
4. Emitir o certificado TLS, por exemplo: `certbot --nginx -d bolao.dominio.com.br`.

Como roda em um container isolado, não interfere no site institucional já existente no mesmo servidor.

## Backup

```bash
docker compose cp bolao:/app/data/bolao.db ./backup-bolao.db
```

## Estrutura

```
bolao-navepro/
├── server.js            # API HTTP
├── db.js                # schema e conexão SQLite
├── scoring.js           # cálculo de pontuação
├── validators.js        # validação de CPF/CNPJ
├── public/              # front (bolão e painel)
├── Dockerfile
├── docker-compose.yml
└── deploy/nginx-bolao.conf.example
```
