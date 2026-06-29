# Bandeja 🍽️

App (site) para gerires os teus serviços de catering nas quintas.
Funciona no **telemóvel** e no **PC**, com tudo guardado **online** (Supabase) e sincronizado.

## O que tem
- 🔒 **Login com email e senha** (só tu vês os teus dados)
- 📊 **Resumo** do mês: ganho, por receber e horas
- 🧾 **Serviços**: quinta + data + horas → calcula sozinho (até passa da meia-noite), com gorjetas e estado **pago/por receber**
- 🏡 **Quintas**: menu para criar e alterar quintas e o valor à hora de cada uma

---

## ⚙️ Configuração (uma só vez, ~10 min)

### 1) Criar a base de dados (Supabase) — grátis
1. Vai a **https://supabase.com** → **Start your project** → cria conta (podes usar o Google).
2. **New project** → dá um nome (ex.: `quintaconta`), escolhe uma password para a base de dados (guarda-a) e a região **West EU (Ireland)**. Carrega em **Create**. Espera ~2 min.

### 2) Criar as tabelas
1. No projeto, menu lateral → **SQL Editor** → **New query**.
2. Abre o ficheiro **`supabase_schema.sql`** (está nesta pasta), copia **tudo** e cola no editor.
3. Carrega em **Run** (canto inferior direito). Deve aparecer *Success*.

### 3) Apanhar as 2 chaves
1. Menu lateral → **Project Settings** (engrenagem) → **API**.
2. Copia o **Project URL** e a **anon public** key.
3. Abre o ficheiro **`config.js`** (nesta pasta) e cola:
   ```js
   window.APP_CONFIG = {
     SUPABASE_URL: "https://xxxx.supabase.co",
     SUPABASE_ANON_KEY: "eyJhbGciOi....(chave longa)....",
   };
   ```
   Grava o ficheiro.

### 4) (Recomendado) Não exigir confirmação de email
Como a app é só para ti, é mais cómodo entrar logo sem confirmar o email:
- Supabase → **Authentication** → **Sign In / Providers** → **Email** → desliga **Confirm email** → **Save**.

> Se deixares ligado, depois de "Criar conta" tens de abrir o email e confirmar antes de entrar.

---

## ▶️ Experimentar no PC
Basta abrir o ficheiro **`index.html`** no navegador (duplo clique).
- Carrega em **Criar conta**, mete o teu email e uma senha (mín. 6 caracteres) → **Criar conta**.
- Depois entra, cria uma **Quinta** (com o valor à hora) e adiciona o teu primeiro **Serviço**.

---

## 📱 Pôr online para usar no telemóvel
Para abrir no telemóvel precisas de um endereço (link). A forma mais fácil e grátis:

**Netlify Drop**
1. Vai a **https://app.netlify.com/drop**
2. Arrasta **a pasta toda** (`app_casamentos`) para a página.
3. Em segundos recebes um link tipo `https://algo.netlify.app` — abre-o no telemóvel.
4. No telemóvel: menu do navegador → **Adicionar ao ecrã principal** → fica com ícone como uma app.

> Alternativas igualmente grátis: **Vercel** ou **GitHub Pages**. Qualquer alojamento de ficheiros estáticos serve (são só ficheiros, sem servidor).

---

## ❓ Problemas comuns
- **"Falta configurar o config.js"** → as chaves no `config.js` ainda não foram preenchidas (passo 3).
- **"Email ou senha errados"** → confirma os dados; se criaste agora a conta e deixaste a confirmação de email ligada, confirma primeiro no email.
- **Não aparece nada / erro a guardar** → confirma que correste o `supabase_schema.sql` (passo 2).

---

## 🗂️ Ficheiros
| Ficheiro | Para quê |
|---|---|
| `index.html` | A página da app |
| `styles.css` | O visual (tema escuro) |
| `app.js` | A lógica (cálculos, ligação à base de dados) |
| `config.js` | **As tuas chaves do Supabase** (preencher) |
| `supabase_schema.sql` | Cria as tabelas na base de dados |
| `manifest.json` / `icon.svg` | Para instalar como app no telemóvel |
