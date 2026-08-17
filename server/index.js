import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const AUTH_USERNAME = process.env.AUTH_USERNAME;
const AUTH_PASSWORD_HASH = process.env.AUTH_PASSWORD_HASH;
const SESSION_SECRET = process.env.SESSION_SECRET;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!OPENAI_API_KEY) {
  console.warn(
    "[server] OPENAI_API_KEY manquante — copie server/.env.example vers server/.env et renseigne ta clé."
  );
}

if (!AUTH_USERNAME || !AUTH_PASSWORD_HASH || !SESSION_SECRET) {
  console.warn(
    "[server] Authentification non configurée — voir server/.env.example et lance `node hash-password.js <mot-de-passe>` pour générer AUTH_PASSWORD_HASH."
  );
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.warn(
    "[server] SUPABASE_URL/SUPABASE_KEY manquants — les fiches enregistrées ne fonctionneront pas. Voir server/.env.example."
  );
}

const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Liste fermée des couleurs Vinted. Sert à la fois de garde-fou dans le prompt
// et de validation côté code : quoi que réponde l'IA, le champ "couleur" final
// est toujours ramené à une valeur (ou deux) de cette liste, jamais une valeur
// inventée. Voir normalizeColorField().
const VINTED_COLORS = [
  "Noir", "Gris", "Blanc", "Crème", "Beige", "Abricot", "Orange", "Rouge", "Bordeaux",
  "Fuchsia", "Rose", "Violet", "Lilas", "Bleu clair", "Bleu", "Bleu marine", "Turquoise",
  "Menthe", "Vert", "Vert foncé", "Kaki", "Marron", "Moutarde", "Jaune", "Argenté", "Doré", "Multicolore",
];

const DIACRITICS_REGEX = new RegExp(
  `[\\u${(0x0300).toString(16).padStart(4, "0")}-\\u${(0x036f).toString(16).padStart(4, "0")}]`,
  "g"
);

function stripAccents(s) {
  return s.normalize("NFD").replace(DIACRITICS_REGEX, "").toLowerCase().trim();
}

const VINTED_COLORS_BY_KEY = new Map(VINTED_COLORS.map((c) => [stripAccents(c), c]));

// Synonymes/teintes courantes qui ne figurent pas telles quelles dans la liste
// Vinted, en secours si l'IA ne les a pas déjà traduites via le prompt.
const COLOR_SYNONYMS = {
  camel: "Marron",
  ivoire: "Crème",
  ecru: "Crème",
  "blanc casse": "Crème",
  "rose fuchsia": "Fuchsia",
  fushia: "Fuchsia",
  "vert olive": "Kaki",
  olive: "Kaki",
  "vert sapin": "Vert foncé",
  sapin: "Vert foncé",
  "bleu ciel": "Bleu clair",
  ciel: "Bleu clair",
  marine: "Bleu marine",
  anthracite: "Gris",
  charbon: "Gris",
  taupe: "Beige",
  sable: "Beige",
  nude: "Beige",
  vin: "Bordeaux",
  grenat: "Bordeaux",
  corail: "Abricot",
  saumon: "Rose",
  mauve: "Violet",
  prune: "Violet",
  or: "Doré",
  argent: "Argenté",
};

function resolveColorToken(token) {
  const key = stripAccents(token);
  return VINTED_COLORS_BY_KEY.get(key) || COLOR_SYNONYMS[key] || null;
}

// Ramène la réponse brute de l'IA à 1 ou 2 couleurs de la liste fermée
// VINTED_COLORS. Si rien ne matche, retombe sur "Multicolore" plutôt que de
// laisser passer une valeur inventée.
function normalizeColorField(raw) {
  if (typeof raw !== "string" || !raw.trim()) return "Multicolore";
  const tokens = raw.split(/[,/]+/).map((t) => t.trim()).filter(Boolean);
  const resolved = [];
  for (const token of tokens) {
    const match = resolveColorToken(token);
    if (match && !resolved.includes(match)) resolved.push(match);
    if (resolved.length === 2) break;
  }
  return resolved.length > 0 ? resolved.join(", ") : "Multicolore";
}

const ANALYZE_PROMPT = `Tu es un vendeur professionnel de vêtements homme d'occasion sur Vinted, pour la marque "Republic Swag" qui vend des vêtements en taille double (une même pièce couvre plusieurs tailles standards : S/M, L/XL, 2XL/3XL).

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ni après, sans balises markdown, au format exact :
{
  "titre": "maximum 25 caractères, très concis : type de vêtement + couleur uniquement. Ne mentionne PAS de taille ni de marque, elles seront ajoutées automatiquement.",
  "description": "3 à 5 phrases naturelles : coupe, matière si visible, détails utiles à l'acheteur. Ne mentionne PAS de taille ni de disponibilité de tailles, ça sera ajouté automatiquement après ton texte. Pas d'emoji excessif.",
  "categorie": "chemin Vinted, ex: Homme > Vêtements > Pulls & Sweats",
  "couleur": "1 à 2 couleurs séparées par une virgule, choisies EXACTEMENT parmi cette liste fermée, recopiées telles quelles (respect des majuscules) : ${VINTED_COLORS.join(", ")}. N'invente JAMAIS une couleur hors de cette liste : si la teinte exacte n'y figure pas, choisis la couleur autorisée la plus proche. Exemples : Camel → Marron ou Beige selon la teinte ; Ivoire/Écru → Crème ; Rose fuchsia → Fuchsia ; Vert olive → Kaki ; Vert sapin → Vert foncé ; Bleu ciel → Bleu clair. Si deux couleurs principales sont clairement visibles à parts comparables, retourne les deux séparées par une virgule (ex: \"Bleu, Blanc\"), jamais plus de deux. Si l'article comporte de nombreuses couleurs sans couleur dominante claire, retourne uniquement Multicolore. Attention aux couleurs ambiguës : un vert fluo/citron/chartreuse (comme un survêtement vert-jaune vif) est du Vert, pas du Jaune — le Jaune n'a pas de composante verte visible. Le Moutarde est un jaune terne tirant vers le marron, pas un jaune vif.",
  "matiere": "matière si visible ou déductible, sinon chaîne vide",
  "prix_suggere": "nombre seul en euros, estimation prudente pour de la seconde main"
}`;

const SUPPORTED_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_PHOTOS = 4;
const MAX_BASE64_LENGTH = 8_000_000; // ~6MB decoded, generous margin under OpenAI's per-image limit

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "30mb" }));
app.use(
  session({
    secret: SESSION_SECRET || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    },
  })
);

// ---- Authentification ----
// Compte unique défini dans server/.env (identifiant + hash bcrypt du mot de
// passe, jamais le mot de passe en clair). Session côté serveur via cookie.

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  res.status(401).json({ error: "Non authentifié." });
}

// Anti-bruteforce basique sur /api/login (mémoire du process : suffisant pour
// une instance unique, à revoir si le serveur tourne un jour en plusieurs répliques).
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LOGIN_MAX_ATTEMPTS;
}

app.post("/api/login", async (req, res) => {
  if (!AUTH_USERNAME || !AUTH_PASSWORD_HASH) {
    return res.status(500).json({ error: "Authentification non configurée sur le serveur (server/.env)." });
  }
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "Trop de tentatives, réessaie dans quelques minutes." });
  }

  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Identifiant et mot de passe requis." });
  }

  const validPassword = await bcrypt.compare(password, AUTH_PASSWORD_HASH);
  if (username !== AUTH_USERNAME || !validPassword) {
    return res.status(401).json({ error: "Identifiant ou mot de passe incorrect." });
  }

  req.session.authenticated = true;
  req.session.username = username;
  res.json({ username });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (req.session?.authenticated) {
    return res.json({ username: req.session.username });
  }
  res.status(401).json({ error: "Non authentifié." });
});

app.post("/api/analyze", requireAuth, async (req, res) => {
  if (!OPENAI_API_KEY) {
    return res.status(500).json({ error: "Clé API OpenAI non configurée sur le serveur (server/.env)." });
  }

  const photos = req.body?.photos;
  if (!Array.isArray(photos) || photos.length === 0) {
    return res.status(400).json({ error: "Aucune photo reçue." });
  }
  if (photos.length > MAX_PHOTOS) {
    return res.status(400).json({ error: `Maximum ${MAX_PHOTOS} photos.` });
  }
  for (const p of photos) {
    if (typeof p?.base64 !== "string" || typeof p?.mediaType !== "string") {
      return res.status(400).json({ error: "Photo invalide." });
    }
    if (!SUPPORTED_MEDIA_TYPES.has(p.mediaType)) {
      return res.status(400).json({ error: `Format non supporté : ${p.mediaType}` });
    }
    if (p.base64.length > MAX_BASE64_LENGTH) {
      return res.status(400).json({ error: "Photo trop lourde." });
    }
  }

  const content = [
    { type: "text", text: ANALYZE_PROMPT },
    ...photos.map((p) => ({
      type: "image_url",
      image_url: { url: `data:${p.mediaType};base64,${p.base64}` },
    })),
  ];

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content }],
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const errBody = await response.json();
        detail = errBody?.error?.message || "";
      } catch {
        // réponse non-JSON, on garde detail vide
      }
      return res.status(response.status).json({ error: detail || `Erreur API (${response.status})` });
    }

    const data = await response.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();

    let fields;
    try {
      fields = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "Réponse IA illisible, réessaie." });
    }

    // Garde-fou côté code : quoi que l'IA ait renvoyé, "couleur" est toujours
    // ramené à la liste fermée VINTED_COLORS avant de sortir du serveur.
    fields.couleur = normalizeColorField(fields.couleur);

    res.json({ fields });
  } catch (err) {
    console.error("[server] /api/analyze failed:", err);
    res.status(502).json({ error: "Impossible de contacter l'API OpenAI." });
  }
});

// ---- Fiches enregistrées ----
// Stockage dans Supabase (Postgres) au lieu d'un fichier local : le disque de
// l'hébergeur (Render, plan gratuit) est éphémère et ne survit pas à une mise
// en veille ou un redéploiement. Table "fiches" : id text pk, fields jsonb,
// photos jsonb, saved_at bigint. Voir server/README-deploy.md pour le SQL.

function requireSupabase(res) {
  if (!supabase) {
    res.status(500).json({ error: "Stockage des fiches non configuré sur le serveur (server/.env)." });
    return false;
  }
  return true;
}

function toIndexEntry(row) {
  return {
    id: row.id,
    titre: row.fields?.titre || "Sans titre",
    thumbnail: row.photos?.[0] || null,
    savedAt: row.saved_at,
  };
}

app.get("/api/fiches", requireAuth, async (_req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase.from("fiches").select("*").order("saved_at", { ascending: false });
    if (error) throw error;
    res.json({ index: data.map(toIndexEntry) });
  } catch (err) {
    console.error("[server] GET /api/fiches failed:", err);
    res.status(500).json({ error: "Impossible de charger les fiches enregistrées." });
  }
});

app.get("/api/fiches/:id", requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { data, error } = await supabase.from("fiches").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Fiche introuvable." });
    res.json({ fiche: { id: data.id, fields: data.fields, photos: data.photos, savedAt: data.saved_at } });
  } catch (err) {
    console.error("[server] GET /api/fiches/:id failed:", err);
    res.status(500).json({ error: "Impossible de charger cette fiche." });
  }
});

app.put("/api/fiches/:id", requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;
  const { fields, photos } = req.body || {};
  if (!fields || typeof fields !== "object" || !Array.isArray(photos)) {
    return res.status(400).json({ error: "Données de fiche invalides." });
  }
  try {
    const { error: upsertError } = await supabase
      .from("fiches")
      .upsert({ id: req.params.id, fields, photos, saved_at: Date.now() });
    if (upsertError) throw upsertError;
    const { data, error } = await supabase.from("fiches").select("*").order("saved_at", { ascending: false });
    if (error) throw error;
    res.json({ index: data.map(toIndexEntry) });
  } catch (err) {
    console.error("[server] PUT /api/fiches/:id failed:", err);
    res.status(500).json({ error: "Échec de la sauvegarde." });
  }
});

app.delete("/api/fiches/:id", requireAuth, async (req, res) => {
  if (!requireSupabase(res)) return;
  try {
    const { error: deleteError } = await supabase.from("fiches").delete().eq("id", req.params.id);
    if (deleteError) throw deleteError;
    const { data, error } = await supabase.from("fiches").select("*").order("saved_at", { ascending: false });
    if (error) throw error;
    res.json({ index: data.map(toIndexEntry) });
  } catch (err) {
    console.error("[server] DELETE /api/fiches/:id failed:", err);
    res.status(500).json({ error: "Échec de la suppression." });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---- Build client en production ----
// En dev, le front tourne séparément sur Vite (voir client/vite.config.js, qui
// proxy /api vers ce serveur). En production (Render), un seul service tourne :
// ce serveur sert aussi les fichiers statiques buildés du client, avec un
// fallback SPA pour toute route qui n'est ni /api/* ni un fichier existant.
const CLIENT_DIST = path.join(__dirname, "..", "client", "dist");

app.use(express.static(CLIENT_DIST));

app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, "index.html"), (err) => {
    if (err) res.status(404).send("Build du client introuvable — lance `npm run build` à la racine.");
  });
});

app.listen(PORT, () => {
  console.log(`[server] API sur http://localhost:${PORT}`);
});
