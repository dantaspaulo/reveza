🌐 [Português](ARQUITETURA.md) · **English**

# Reveza AI: architecture

Manager for several coding assistant accounts, with a cloud panel, automatic account switching and usage tracking.
Works with Claude Code (the only mention of the name is in the installation and in the requirements). Open project, MIT
license.

This document is the source of truth for anyone building Reveza. Decisions made by the project owner on October 10 and 11, 2026.

## 1. Principles

1. **An account login is never in the clear outside the computer.** The vault in the cloud holds ciphertext only. The
   vault key exists only on the user's computers (system keychain). Vercel and Supabase cannot decrypt it.
2. **The cloud orchestrates.** It decides which computer uses which account, based on the usage the computers report.
   Without internet, the computer keeps the current account and does not switch (accepted by the owner).
3. **The computer only calls the cloud.** No open port, no tunnel. It polls every 5 s.
4. **Least privilege everywhere.** No server key outside Supabase. Vercel uses the public key and the token of the user who is
   signed in. Each computer has its own identity, revocable on its own.
5. **Every installation owns everything.** Supabase, Vercel and the domain belong to the person who installs. Nothing
   goes through the project author's server.

## 2. Components

| Piece | Technology | Where it runs | Role |
|---|---|---|---|
| `agente` | Node 18+ (compiled TypeScript), native modules only + `@supabase/supabase-js` | each computer | swaps the local credential, reads the usage of the accounts it has at hand, renews the login, encrypts and decrypts the vault, records transcription usage, resumes a session |
| `mod` | Claude Code hooks module | each session | live usage, limit warning, session resume, `/reveza` |
| `nuvem` | Supabase (Postgres + RLS, Auth with MFA, Edge Functions, pg_cron) | the person's project | state, decisions, encrypted vault, queues, alerts, audit and its own update (`atualizar-nuvem`, 7e) |
| `painel` | Vite + React + TypeScript + Tailwind v4 + shadcn/ui (official blocks) + free React Bits (downloaded at install) | the person's Vercel | everything the person sees and controls, pt-BR and en, installable on the phone (PWA) |
| `instalador` | Node (`npx github:<dono>/reveza`) | the person's computer | questions, provisions Supabase and Vercel, the domain, the first computer and the accounts, alerts, final check |
| `cli` | the `agente` itself (`reveza status`, `reveza trocar`, `reveza uso --csv`, `reveza doctor`) | computer | script integration and diagnostics |

Why the agent moved from Python to Node: Windows has no Python out of the box, Node is already required by the installer
and by Claude Code, and Node has native AES-256-GCM and scrypt (default Python has no authenticated cipher).

## 3. Where each account's login lives on the computer

| System | Active credential | Stored credential for each account |
|---|---|---|
| macOS | keychain, service `Claude Code-credentials` (written through `security -i` when it fits in ~4 KB, argv when it does not, like Claude Code itself) | keychain, service `Claude Code-credentials-<sha256(pasta)[:8]>` of the folder `~/.reveza/contas/<id>` |
| Linux and Windows | `~/.claude/.credentials.json` (mode 600 on Linux; profile ACL on Windows) | `~/.reveza/contas/<id>/.credentials.json` |

Rules inherited from the router (proven on October 10 and 11, with a test):
- a switch touches only `claudeAiOauth` and `organizationUuid`; `mcpOAuth` belongs to the machine and stays;
- never renew from the stored copy of the active account (the refresh token rotates);
- never renew and switch the same account at the same time (a per-account lock); a destination close to expiring is
  renewed first;
- check the primary 5 s after the switch and redo it if a session wrote the old account back;
- a new login only counts if the account that came back is the one requested.

## 4. Encrypted vault

- Vault key `K`: 32 random bytes, created on the first computer, kept in the system keychain
  (macOS: Keychain; Windows: the user's DPAPI, in a file under `~\.reveza\segredos`; Linux: `secret-tool` when there is
  one, otherwise a file with mode 600 and a warning).
- Each stored login: `AES-256-GCM(K, random 12-byte nonce, JSON with only claudeAiOauth and organizationUuid)`, with
  associated data `conta_id|versao` (it stops one account's ciphertext from being swapped for another's).
- A new computer receives `K` encrypted for it alone (0.2.0; finding 2 of the October 11, 2026 security review, where the
  `rvzl_` code carried the vault phrase as reversible text). It creates an ECDH P-256 pair in memory only (private key
  not exportable) and registers the public key in its request (`ligacao_pedidos`). The computer that has `K` checks the
  12-character code the person types (`XXXX-XXXX-YYYY`: the first part comes from the public key, the second is drawn at
  random and never goes to the cloud), encrypts `K` for that public key with the drawn part (ephemeral ECDH +
  HKDF-SHA256 with the drawn part in the salt + AES-256-GCM, labels `reveza-ligacao-computador-v3`, associated data with
  the new computer's id) and delivers it through the cloud, which sees ciphertext only and erases the envelope on the
  first read. The new one only opens an envelope made with its own drawn part and still checks the fingerprint of `K`
  against the installation's before storing it. Details in section 8.
- Emergency (a computer already linked that lost `K`): the **emergency phrase** of 6 words. The computer that has `K`
  generates the words (`reveza ligar --mostrar-frase`), derives a key with scrypt and publishes `K` wrapped for 10
  minutes; the other one types the words (`reveza ligar --frase`) and unwraps it. The phrase does not go to the cloud and
  does not join a new computer (the pending identity does not reach an active computer without receiving `K` through the
  request).
- Lost every computer: the vault does not come back (that is the price of the cloud not being able to read it). The
  accounts are connected again through the official sign-in.

## 5. Account ownership (one account, one computer at a time)

The refresh token rotates on every use. Two computers with the same copy burn each other's login. So:
- `posse(conta_id, computador_id, desde, expira_em)`: only the holder of the ownership uses or renews
  that account.
- The computer renews the ownership on every poll (it expires in 2 min without a renewal). Before letting an account go,
  it encrypts the newest login and gives it back to the vault, and only then lets it go.
- Reading the usage of a stopped account: the cloud picks a computer that is on, which takes a short ownership, renews
  if needed, reads, gives it back to the vault and lets it go.

## 6. Decision (in the cloud)

The `decidir()` function in Postgres, called by pg_cron every minute and right away by a trigger when new usage or a
limit warning arrives. For each computer that is on:
- mode `limite` (only at the limit), `limiar` (warning and switch) or `rodizio` (from time to time, interval drawn
  between 75% and 125%, a free account drawn at random or the least used one), with the threshold acting as a safety net;
- it respects the preference order, the backup account (only when there is no other), the schedule, the weekly cap and
  the week plan (the week quota split over the remaining days);
- a window counts as full by the highest of the 5-hour window, the week and the per-model-family week; a reset that has already passed counts as zero;
- a minimum wait of 90 s between switches on the same computer, except when the session hit the limit;
- each computer's preferred account (an account is the preferred one of a single computer): for that computer it comes
  before the other candidates; with automatic switching on, the computer goes back to it when it becomes free, after the
  wait, unless the current account was picked by hand (panel or API), which stays until the rule's next switch; in
  rotation it stays on it; at the limit, it switches like any other. For the other computers, while its owner is
  connected, it comes after all the others, and whoever has it gives it back and takes the best one left (never a backup
  account nor a third computer's preferred one);
- it writes the decision to `atribuicao(computador_id, conta_id, motivo, versao)` and to `eventos`.

## 7. Cloud: tables (all with RLS on)

| Table | Who reads | Who writes |
|---|---|---|
| `membros(user_id, papel)` role: `admin`, `leitura`, `computador` | member | admin (invitation through an Edge Function) |
| `convites(email, papel, expira_em, criado_por)` | admin | admin |
| `computadores(id, user_id, nome, sistema, versao, visto_em, revogado, conta_preferida)` | member | the computer itself (its own record); admin revokes and picks the preferred account |
| `contas(id, email, organizacao, plano, cor, prioridade, reserva, pausada, agenda, teto_semana)` | member | admin; the computer writes plan and organization |
| `cofre(conta_id, cifrado, nonce, versao, gravado_por, gravado_em)` | computer only | computer with ownership only |
| `posse(conta_id, computador_id, expira_em)` | member | only through a function (`pegar_posse`, `soltar_posse`) |
| `atribuicao(computador_id, conta_id, motivo, versao)` | member | only the `decidir` function |
| `uso_janelas(conta_id, tipo, pct, reset_em, lido_em, fonte)` | member | computer |
| `uso_tokens(dia, hora, conta_id, computador_id, projeto, modelo, entrada, saida, cache_escrita, cache_leitura, usd, respostas)` | member | computer |
| `sessoes(id, computador_id, projeto, inicio, fim, agentes, usd, contas)` | member | computer |
| `eventos(em, tipo, texto, dados)` | member | functions and computer |
| `comandos(id, criado_por, computador_id, acao, corpo, estado, resposta)` | member | admin creates; the computer reserves and answers |
| `ligacao_pedidos(computador_id, aprovador, idioma, publica, pedido_em, expira_em, envelope, entregue_por, entregue_em, lido_em, recusado)` | member, without `publica` and `envelope` | the new computer registers the public key (once); an active computer delivers or refuses; admin picks the approver |
| `config(chave, valor)` mode, thresholds, rotation, interval; and, read-only, the cloud version and what is online (7e) | member | admin (the 7e ones: cloud functions and the installer only) |
| `credenciais_atualizacao(nome, cifrado, nonce, gravado_por, gravado_em)` the full update tokens, encrypted with `K` | nobody outside (neither the panel nor the service key); an active computer through a function | active computer (on and off); admin only deletes |
| `alertas(canal, destino_cifrado, eventos, ativo)` | admin | admin |
| `auditoria(em, user_id, acao, alvo, ip)` | admin | triggers (nobody edits) |
| `chaves_api(id, user_id, prefixo, hash, escopos, criada_em, usada_em, revogada)` | the key's owner | the user |

Panel actions that change anything go through a Postgres `security definer` function that checks the role, writes the
audit log and validates the input; the panel never writes straight to a table.

Fixes from the October 11, 2026 security review (migrations 0007 and 0008, tests in `nuvem/testes/revisao-seguranca` and
`painel-extra`):
- reading invitations, alerts, webhooks and the audit log requires an administrator WITH two-factor;
- each alert channel's secret (Vault) is only attached to the channel by the function itself; the destination is checked
  per channel, and every address the cloud calls is public https (no literal IP, no port other than 443, no user in the
  URL, no internal name), checked in the database and again in the Edge Function, which does not follow redirects;
- the login code pasted in the panel leaves `comandos` as soon as the computer reserves the request;
- a new invitation cancels the previous one for the same e-mail, an invitation can be cancelled, and accepting never
  demotes an administrator;
- revoking a computer turns off its login in Auth and drops its sessions;
- an account can only be assigned to one computer (unique index and a lock in `rvz_atribuir`);
- the `ligar` command (0.1.x: the phrase encrypted for the browser): removed in 0.2.0. `painel_comando` refuses the action
  and the agent answers 410; a new computer joins through the code that shows up on it (section 8).

## 7b. Local bridge (mod and command line ↔ agent)

HTTP on 127.0.0.1 only, Host checked (against DNS rebinding), header `X-Reveza: 1` (the browser does not send it without
a preflight, and the bridge does not answer preflights) and proof of the local key that lives in `~/.reveza/ponte.chave`
(64 hex, file 600): `X-Reveza-Prova` = HMAC-SHA256(chave, "MÉTODO\ncaminho\ntempo\nnonce"), with `X-Reveza-Tempo` (60 s)
and `X-Reveza-Nonce` (single use). The key never travels: if another program is on the port instead of the agent, it
does not learn the key. Another user on the same computer, who can reach 127.0.0.1, cannot read e-mails or force a
switch. A session resume only happens in the folder recorded in the session's own transcript (never in the one that
arrives through the bridge), and the text the mod puts in the prompt is fixed.

## 7c. Database updates

`reveza_migracoes(nome, hash)`: a new migration goes in; a file marked `-- reaplicável` (functions, policies and
idempotent indexes only) runs again when it changes; a table migration that changed after being applied is refused (it
goes into a new migration); after the first one that goes in, every following re-appliable one runs again, in order (a
function defined in more than one file always ends up with the body of the last one: in the jump from 0.3.0 to 0.3.1,
only 0020 ran and `agente_vez_de_atualizar` went back to its body, without the publication gate of 0021; fixed in
0.3.2); the permissions (0099) close any application. An installer older than the cloud does not touch it. The push keys
(VAPID) are born once. The same rule holds on both paths: the installer (Management API, with the token) and, since
0.3.0, the cloud itself (7e), which applies each migration in a transaction. That is why a new migration cannot control
its own transaction or use `concurrently` or `vacuum` (the cloud refuses before starting and says why).

## 7d. Updating the computers' program

The panel only asks (`atualizar` with `{ versao: "mais_nova" }`, or `{ conferir: true }` in Check for updates); the agent
is the one that picks, downloads and installs (`agente/src/atualizar.ts`): a published version of the official
repository only, newer than its own, through the installer of that new version itself, in a separate process, with the
state copy and the automatic rollback.
- **Check for updates** (0.2.1): each computer that is on reads the published version right away (at most once a minute;
  in the normal cycle, every 6 hours) and answers `{ atual, mais_nova, nova, atualizando, precisa_nuvem }`.
- **Update by itself** (`config.atualizar_sozinho`): off (`false`, the default), overnight (`true`, from 3 a.m. to 5 a.m.
  in the local timezone) or `"assim_que_sair"` (as soon as the agent finds the new version). Overnight stays `true` in
  the database so that agents from before 0.2.1 understand it. With either one on: only when the computer is calm (no
  account switch going on and no session at the limit) and one at a time (`atualizacao_vez`, 0018 and 0020); if one rolls
  back to the previous one, the others stop and an alert goes out. The 0.2.1 agent reports in the diagnostics that it
  understands "as soon as it comes out" (`assimQueSair`); the older ones only go by themselves overnight, and the panel
  leaves Update all to them.
- **Compatibility lock**: a new version may bring a cloud migration. Before running the installer, the agent compares
  the migrations in the downloaded package (`nuvem/migracoes`) with the ones the cloud has already applied
  (`agente_migracoes()`: the names and, since 0.3.1, the sha256 digest of each one in `reveza_migracoes`; the computer
  does not read the table). Missing is the one whose name is not there and, while the cloud is on an earlier version
  (`nuvem_versao`), also the re-appliable one that exists with other content (0099 changes on nearly every version);
  with the cloud on the same version or ahead, the name alone is enough. The digest is of the text with LF line endings
  (`.gitattributes` pins LF in the `.sql` files; one recorded with CRLF by a Windows clone from before 0.3.1 also
  counts), the same in the installer, in the `atualizar-nuvem` function and in the agent. If any is missing, or if the
  cloud has no function or no record, it does not update: the panel shows "Version Y needs the cloud updated first: use
  Update the cloud" (up to 0.2.1 it was on the primary computer, with the tokens; since 0.3.0 the cloud updates itself,
  7e), and the agent checks the cloud every 5 minutes (without downloading again) until it can go on. A table change
  still goes into a new migration file: the installer refuses a table migration that changed.
- **The order** (0.3.0): with the full update on (7e), the turn to update by itself (`agente_vez_de_atualizar`) waits for
  the functions and the panel of the cloud version to go online (`motivo: publicacao`), and stops if the publication
  stopped (`publicacao_falhou`). While a computer is publishing, it does not update itself (the publication is a
  process of its own).

## 7e. Updating the cloud and the panel (0.3.0)

Owner's request (October 12, 2026): the cloud and the panel also update themselves, with the least privilege possible. The
order is cloud → functions and panel → computers, and a step that fails stops the following ones, flags it in the panel
and sends the alert (`atualizacao_falhou`, with `parte`: `nuvem` or `publicacao`).

**1. The cloud applies its own migrations, with no stored credential.** The `atualizar-nuvem` Edge Function
(`nuvem/funcoes/atualizar-nuvem`) uses the connection the platform gives the functions (`SUPABASE_DB_URL`, documented as
the project's Postgres URL; client `jsr:@db/postgres` 0.19.5, the one from Supabase's official Edge Functions example).
- Who asks: the administrator through the panel (**Update the cloud**; the same two-step rule as always), or the hourly
  pg_cron (`reveza-atualizar-nuvem`, migration 0022, with the alerts cron secret), which follows the **Update by
  itself** choice (off does nothing; overnight, from 3 a.m. to 5 a.m. in the local timezone; as soon as it comes out, at
  any time). The automatic one does not retry a version that failed: the administrator is the one who asks again.
- The agent's rules (7d): a repository fixed in the code, published versions only (the releases API; when it refuses,
  because of the request limit on the address the functions share, the `/releases/latest` page, which only points to a
  published version) and newer than the cloud's, the tag package assembled in the code and redirects to `github.com` and
  `codeload.github.com` only. The `.tar.gz` is read in memory, with a size limit, refusing links and paths that go
  outside; the `package.json` has to be Reveza's, at the requested version.
- Before anything, it checks that the connection owns (or inherits the owner role for) the tables and functions the
  migrations rebuild; if it does not, it stops without touching anything and reports the roles (the cloud then goes
  through the installer).
- It applies the 7c plan, each migration in a transaction with `pg_advisory_xact_lock` (778805), a `lock_timeout` of
  15 s and the record checked again inside the lock: two rounds running together do not apply the same migration twice,
  and the one that fails leaves nothing of its own behind (the previous ones stay, and the next round continues from
  there). One round at a time (`servico_nuvem_comecar`, the turn is good for 10 minutes). At the end, `nuvem_versao`
  (goes up only), `nuvem_atualizacao` and the per-part digests (`impressoes`).
- The `servico_nuvem_*` functions are not granted to any role from outside, not even the service key: only the database
  owner, through the function's connection.
- Proven in the tests: all of today's migrations run one transaction each, through the function's path, with a role that
  is not a superuser and only has what Supabase's `postgres` role has (create in `public`, reference `auth.users`, the
  Auth, Vault and pg_cron functions); 0005 (which creates the pg_cron and pg_net extensions) does not run on the test
  Postgres. Not proven here: the exact role of `SUPABASE_DB_URL` in a real project and whether it is the same one the
  installer used (the Management API); the function checks that every time and stops with the reason if it is not.

**2. Functions and panel need a credential: optional and end-to-end encrypted.** Publishing a function requires the
Supabase personal token (it reaches the whole account) and publishing the panel, the Vercel token.
- Off by default. `reveza atualizacao-completa ligar` (or the offer at the end of the installation, default no) asks for
  both without echo, shows what it costs and how to narrow the reach (Vercel: scope to the panel's team and an expiry;
  Supabase: an expiry and an account with the Reveza organization only), checks that they reach the project and the
  account, encrypts each one with `K` (AES-256-GCM, associated data `reveza-atualizacao|<nome>`) and stores them in
  `credenciais_atualizacao` (the key fingerprint has to be the installation's). `desligar` (or Turn off, in the panel)
  deletes them; to remove access for good, delete the tokens in Supabase and Vercel. Whoever has a computer of the
  installation has `K`, and therefore the tokens.
- The cloud stores the panel data that only the creating computer used to know (`painel_publicacao`: project, team,
  domain, addresses, push public key; never a token) and what is online (`publicado`).
- What is still missing publication (`rvz_publicacao_pendente`, the same rule in the agent and in the panel): a part is
  up to date when the version online is already the cloud's, or when the function computed the same digest for both
  versions (`impressoes`: the functions with `nuvem/provisionar.mjs`, the panel with the build and the publication; no
  tests or hidden files).
- With the tokens stored, the first computer that is on and calm (any system with the agent's Node) takes the turn
  (`agente_vez_de_publicar`, one at a time; the same computer resumes a publication that died halfway; another one only
  after 45 minutes, and then the earlier one becomes a failure), downloads the official package of the cloud version and
  runs ITS installer with `--publicar-nuvem --ref <projeto> --partes funcoes,painel`, with the tokens through standard
  input only. The installer only publishes if the cloud is already on that version, runs the provisioning (the
  migrations already went in; the plan comes out empty) and builds the panel on that computer, with the free React Bits
  downloaded there, as in the installation; Vercel receives the result only, and the new deployment only becomes the
  production one when it is ready (the old panel stays online until then). The output goes to
  `logs/publicacao-X.log` without any piece of the tokens; the end goes to `agente_publicacao_resultado`.
- Without the tokens, nothing changes: the panel shows the manual step only when the version changes the functions or
  the panel.

**3. In the panel**, the "Cloud and panel" line at the top of the Updates card: the versions, **Update the cloud**
(administrator; it also unblocks a stopped publication) and the state (up to date, updating, publishing, manual step,
waiting for the publication, failed with the reason, cloud from before 0.3.0).

## 8. Authentication and access

- Supabase Auth with a password + two-factor (TOTP) for `admin`: anyone who turned it on needs the code on every session;
  anyone who did not acts with the password alone, unless the installation requires it (`exigir_duas_etapas`). The database
  is what checks (`rvz_exigir_admin` = admin and `rvz_aal2`), along with the Edge Functions (`servico_aal_ok`); there is
  no panel server.
- A new computer (0.2.0; protocol 3 since 0.4.0): the code shows up on IT and is typed on a computer that already has
  the vault key; no secret goes through the panel screen.
  1. The panel creates the pending identity (Edge Function `computador-novo`, a `pendente` row in `computadores`, visible
     and revocable) and picks the approver, the computer where the window opens (`painel_ligacao_aprovador`, with the
     panel's language). It shows the installer command and the access code `rvzc_` (address, anon key, e-mail and
     password of the pending identity). That code only lets it ASK: the pending identity can only reach
     `agente_ligacao_pedir` and `agente_ligacao_receber`, and `agente_registrar` refuses it until it reads the delivered
     key (except for the first identity of the installation, before `cofre_impressao` exists, which creates the key).
     The `rvzl_` and `rvzpc_` codes are refused.
  2. The new computer (`reveza ligar`, called by the installer with `--ligar`) creates the ECDH P-256 pair in memory and
     registers the public key: one request per computer, which cannot be replaced (the same key again returns the same
     request) and expires in 10 minutes. It shows the code `XXXX-XXXX-YYYY` in large letters (32 symbols, without
     0/O/1/I): `XXXX-XXXX` are 40 bits taken from the SHA-256 of the public key stretched by scrypt (N=2^15, r=8,
     ~40 ms); `YYYY` are 20 bits drawn at random (0.4.0), which do not go to the cloud and get no verifier there. It
     waits for the delivery by polling the cloud.
  3. The approver's agent sees the request in `agente_ola.ligacoes`, plays the sound and opens the window (macOS
     `osascript`, Windows `InputBox`, Linux `zenity --entry`) that ASKS for the code, without showing it; the text is
     fixed, only the language comes from the cloud. A wrong code asks again, and on the third one the request is refused;
     the Refuse button rejects the request; with no answer within 90 s the request stays open. `reveza ligar XXXX-XXXX-YYYY` does the same
     without a window (server, VPS, SSH), on any computer that has the key. With the first part right, it encrypts `K`
     for the request's public key with the drawn part and delivers it (`agente_ligacao_entregar`, which checks the same
     public key and allows one delivery). A typo in the drawn part only shows up on the new computer, which does not
     open the envelope and asks for another code.
  4. One request at a time: two open at once are refused by the agent (and by the delivery itself, in the database), and
     a request that arrives with the window open nullifies whatever is typed in it (October 11, 2026 security review).
  5. The new computer reads the envelope once (the database erases it), decrypts it with the private key and the drawn
     part, checks the fingerprint against `cofre_impressao` and stores `K` in the keychain; only then does it register
     as a computer. The panel follows it through `ligacao_pedidos` (without the public key and without the envelope).
  What a leaked code can do: the `rvzc_` before use lets someone register a public key in the request (the real computer
  then gets an error, and the computer approving it does not have the intruder's code on screen); after use, the request does
  not accept another key. It does not open the vault and does not become an active computer. Whoever writes straight to
  the database (database owner, service key):
  - does not take `K`: replacing the public key with one of its own with the same first part takes 2^40 attempts, each
    with a scrypt, in 10 minutes. It holds even for anyone who also sees the new computer's screen;
  - cannot plant a key on the new computer: the envelope asks for the drawn part, and the new computer stops at the first
    one that does not open (1 chance in 2^20). Up to 0.3.x the whole code came from the public key, and that writer
    could assemble the envelope with a key of its own and swap the fingerprint along with it (October 12, 2026 security audit,
    round 3). Whoever writes to the database AND sees the new computer's screen can still plant one: that is why the
    screen asks you not to send a picture of the code.
  - A fully random code, checked by a verifier in the cloud, was considered and discarded: anyone who saw the screen and
    could write to the database would swap the public key and take `K`.
  The release without asking (`reveza ligar --painel ligar`, 0.1.x) is gone: it let the cloud authorize on its own.
- Public sign-up off; you only get in by invitation (single-use link, expires in 72 h).
- Password change with reauthentication; "forgot password" with a redirect to the panel's domain only.
- Session: a 1-hour JWT with renewal; session list and "sign out of all" (it revokes the user's refresh tokens).
- Computer: its own Auth user, role `computador`, a long random password in the computer's keychain; revoking the
  computer = disabling that user.
- Personal API keys (for scripts and n8n): visible prefix, stored hash, scopes (`ler`, `trocar`), revocable.

## 9. Panel

A side menu, nothing piled up on a single screen:
1. **Overview**: account in use per computer, pace, forecast, alert bands.
2. **Accounts**: list, color, priority, backup, schedule, weekly cap, connect (generates the request to the computer),
   sign in again, pause.
3. **Computers**: list, system, version, last seen, account in use, preferred account, link a new computer (the code shows up on it and is
   typed on a computer that already uses Reveza; the panel only follows it), revoke; updates (the Cloud and panel line
   with Update the cloud, section 7e; Check for updates, Update all, how to update by itself and the progress,
   section 7d).
4. **Usage**: equivalent cost, tokens, agents, sessions per day, account, model, project and computer; heat map;
   ranking; forecast of running out; export spreadsheet.
5. **Week plan**: weekly quota per account split over the days, how much is gone, pace alert.
6. **Auto switch**: on and off, mode (only at the limit, threshold, rotation), thresholds, interval, order, schedule.
7. **Alerts**: channels (Telegram, e-mail, webhook, phone notification), which events, a test button; and, per browser,
   the account switch warning with a notification and a sound while the panel is open.
   The switch that did not stick (0.4.5) is one of those events: the computer writes an error with
   `motivo: troca_falhou` and the account ids when the switch does not stick after 3 attempts, or when the account the
   cloud assigned does not sign in for 5 minutes and 3 polls; a cloud trigger (migration 0023) reads the ids only and
   writes the alert with the computer's name and the e-mails from its tables, at most one per computer per hour.
8. **Integrations**: API keys, outgoing webhooks, ready-made examples (n8n, curl, script).
9. **Team**: members, roles, invitations, audit log.
10. **My account**: password, two-factor, open sessions, language.
11. **How it works**: an animated diagram of the path (official sign-in on the computer, encrypted vault, cloud decides,
    computer switches) and of the rotation rule, with examples.
12. **Health**: each computer's `doctor` result, poll delay, version.

Demo mode: `?demo=1` or an installation with `--demo` turns on example data generated in the browser itself, with no
cloud.

## 10. Installer (in the Claquete style)

`npx github:<dono>/reveza` with `--atualizar`, `--desinstalar`, `--sem-nuvem`, `--demo`, `--doctor`, `--dominio`,
`--ajuda` (and, for the agent's use, `--publicar-nuvem`, 7e).
Steps: system check, agent and mod, joining an installation that already exists (a new computer only, with the panel's
code), cloud (Supabase token, creates the project, applies the database and the functions, creates the administrator
with two-factor, creates the computer identity and the vault key; the Vercel token is asked for here too), service, panel
(publishes, headers; domain: your own subdomain with the Cloudflare walkthrough, or the Vercel one; interface: free React
Bits downloaded, the repository does not carry React Bits code), accounts (the official sign-in for each one), alerts
(chosen channel, test message), final check (`doctor` and a panel command reaching the computer).

The steps are numbered from 1 to N using only the ones that run on that path (`instalador/lib/etapas.mjs`): linked
computer, update and `--sem-nuvem` have fewer steps, with no number skipped. On an update with a cloud, leaving the
Supabase token blank keeps the cloud and the panel as they are, and the following steps come out with the new total.

Automatic switching is not a question: a new installation writes it as on, before the limit (warns at 90%, switches at
95%), in the cloud or, with `--sem-nuvem`, in the local state; change it in the panel. Update, join and `--importar` do
not write a switching setting (the one already in force stays; `--com-nuvem` takes the local state's to the cloud). The
database is born with switching off; the installer is what turns it on.

Panel domain: if you choose nothing, Vercel's free address (`<projeto>.vercel.app`, with HTTPS). `--dominio
<subdomínio>` turns the domain on or changes it (at install time with no question; in `--atualizar`, with the tokens) and
`--dominio vercel` goes back to the Vercel address; `REVEZA_DOMINIO` still works. The record walkthrough is
provider-neutral, with the Cloudflare tip (proxy off) as a note.

At the end of the installation (and of `--atualizar` with the tokens), the full update offer (7e), default no; with
`--sim` or no terminal, it stays off. After publishing, the installer writes `nuvem_versao`, `publicado` and
`painel_publicacao` to the cloud.

When it asks for each token, the installer opens the page to create it (`open`, `xdg-open` or `explorer.exe`), only with
a screen and a question: never with `--sim` or no terminal, over SSH without a screen, or with the token already in the
environment; on an update, where the Supabase token is optional, that page does not open. Failing to open stops nothing:
the address is printed.

**Language.** The installer's first step asks for your language (Portuguese or English) and writes it to
`~/.reveza/instalacao.json` (field `idioma`); `--idioma pt|en` skips the question. The agent reads that field on every
run, and the mod reads it by absolute path, so both speak the language chosen at install time. In the panel the
language is per user: it lives in the browser (localStorage) and in the user's account (`membros.idioma`), and does not
change anyone else's.

## 11. Security of the published panel

A strict CSP (`script-src 'self'`, `connect-src` only the installation's Supabase), HSTS, `frame-ancestors 'none'`,
Permissions-Policy, a single domain (the `*.vercel.app` one redirects), a login attempt limit (Supabase's own and, if the
person uses Cloudflare in front, a rate limit rule and Turnstile), no source map online.

## 12. Outside the repository

Credentials of any kind (the pre-commit hook refuses them), React Bits code, e-mails and data of any real account.
