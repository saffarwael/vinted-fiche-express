import React, { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Copy, Check, Trash2, Loader2, ImagePlus, ChevronRight, X, ClipboardList, Download, Bookmark, BookmarkCheck, RotateCcw, Library, LogOut } from "lucide-react";
import { COLORS } from "./theme.js";
import { useAuth, LoginScreen } from "./Auth.jsx";

const FIELD_ORDER = [
  { key: "titre", label: "Titre" },
  { key: "description", label: "Description" },
  { key: "categorie", label: "Catégorie" },
  { key: "marque", label: "Marque" },
  { key: "taille", label: "Taille" },
  { key: "couleur", label: "Couleur" },
  { key: "etat", label: "État" },
  { key: "matiere", label: "Matière" },
  { key: "prix_suggere", label: "Prix suggéré (€)" },
];

// ---- Persistence (serveur local, remplace window.storage de l'artefact Claude.ai) ----
// Les fiches enregistrées vivent dans server/data/fiches.json, pas dans le
// navigateur : elles restent visibles depuis n'importe quelle fenêtre/navigateur
// qui pointe vers ce même serveur local.

async function loadSavedIndex() {
  const res = await fetch("/api/fiches");
  if (!res.ok) throw new Error("Impossible de charger les fiches enregistrées");
  const data = await res.json();
  return data.index;
}

async function saveFicheToStorage(item) {
  const res = await fetch(`/api/fiches/${item.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: item.fields,
      photos: item.downloadPhotos.map((dp) => dp.dataUrl),
    }),
  });
  if (!res.ok) throw new Error("Échec de la sauvegarde");
  const data = await res.json();
  return data.index;
}

async function deleteFicheFromStorage(id) {
  const res = await fetch(`/api/fiches/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Échec de la suppression");
  const data = await res.json();
  return data.index;
}

async function fetchFicheFromStorage(id) {
  const res = await fetch(`/api/fiches/${id}`);
  if (!res.ok) throw new Error("Fiche introuvable");
  const data = await res.json();
  return data.fiche;
}

function formatSavedDate(ts) {
  try {
    return new Date(ts).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch (e) {
    return "";
  }
}

const FIXED_BRAND = "Republic Swag";
const FIXED_SIZE = "M";
const SIZE_RANGE_LABEL = "S/M L/XL 2XL/3XL";

// La liste fermée des couleurs Vinted et sa validation vivent côté serveur
// (server/index.js) : c'est le seul point de passage de la réponse de l'IA,
// donc le seul endroit où l'enforcement doit avoir lieu. Voir normalizeColorField().
function applyFixedBusinessRules(fields) {
  fields.marque = FIXED_BRAND;
  fields.taille = FIXED_SIZE;
  fields.etat = "Neuf avec étiquette";
  fields.titre = `${(fields.titre || "").trim()} ${SIZE_RANGE_LABEL}`.trim();
  const desc = (fields.description || "").trim();
  fields.description = `${desc}\n\nTailles disponibles (coupe double, une pièce couvre deux tailles) : S/M, L/XL, 2XL/3XL.`;
  return fields;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function dataUrlToUint8Array(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function concatUint8Arrays(arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  arrays.forEach((a) => {
    result.set(a, offset);
    offset += a.length;
  });
  return result;
}

function crc32(data) {
  let crc = ~0;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

// Crée un fichier ZIP (méthode "store", sans compression) à partir de plusieurs
// fichiers en mémoire, sans dépendance externe, et le renvoie en data URL.
function createZipDataUrl(files) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const size = data.length;

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, dosTime, true);
    view.setUint16(12, dosDate, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, size, true);
    view.setUint32(22, size, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cview = new DataView(centralHeader.buffer);
    cview.setUint32(0, 0x02014b50, true);
    cview.setUint16(4, 20, true);
    cview.setUint16(6, 20, true);
    cview.setUint16(8, 0, true);
    cview.setUint16(10, 0, true);
    cview.setUint16(12, dosTime, true);
    cview.setUint16(14, dosDate, true);
    cview.setUint32(16, crc, true);
    cview.setUint32(20, size, true);
    cview.setUint32(24, size, true);
    cview.setUint16(28, nameBytes.length, true);
    cview.setUint16(30, 0, true);
    cview.setUint16(32, 0, true);
    cview.setUint16(34, 0, true);
    cview.setUint16(36, 0, true);
    cview.setUint32(38, 0, true);
    cview.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  });

  const centralDirSize = centralParts.reduce((sum, p) => sum + p.length, 0);
  const centralDirOffset = offset;

  const endRecord = new Uint8Array(22);
  const eview = new DataView(endRecord.buffer);
  eview.setUint32(0, 0x06054b50, true);
  eview.setUint16(4, 0, true);
  eview.setUint16(6, 0, true);
  eview.setUint16(8, files.length, true);
  eview.setUint16(10, files.length, true);
  eview.setUint32(12, centralDirSize, true);
  eview.setUint32(16, centralDirOffset, true);
  eview.setUint16(20, 0, true);

  const allBytes = concatUint8Arrays([...localParts, ...centralParts, endRecord]);
  return `data:application/zip;base64,${uint8ArrayToBase64(allBytes)}`;
}

function downloadAllPhotos(item) {
  const files = item.downloadPhotos.map((dp, i) => ({
    name: `photo-${i + 1}.jpg`,
    data: dataUrlToUint8Array(dp.dataUrl),
  }));
  const zipDataUrl = createZipDataUrl(files);
  const a = document.createElement("a");
  a.href = zipDataUrl;
  a.download = `vinted-fiche${item.index}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function fileToResizedBase64(file, maxDim = 1568, quality = 0.85) {
  const readAsDataUrl = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Impossible de lire le fichier"));
    reader.readAsDataURL(file);
  });

  const load = (async () => {
    const dataUrl = await readAsDataUrl;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, width, height);
          const resizedDataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(resizedDataUrl.split(",")[1]);
        } catch (e) {
          // Si le redimensionnement échoue pour une raison quelconque, on retombe
          // sur l'image d'origine encodée telle quelle.
          resolve(dataUrl.split(",")[1]);
        }
      };
      img.onerror = () => reject(new Error("Impossible de lire cette image"));
      img.src = dataUrl;
    });
  })();

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("La photo a mis trop de temps à se charger")), 15000)
  );

  return Promise.race([load, timeout]);
}

const VINTED_PHOTO_WIDTH = 1080;
const VINTED_PHOTO_HEIGHT = 1350; // ratio 4:5, format portrait recommandé par Vinted

async function fileToVintedPhoto(file, quality = 0.92) {
  const readAsDataUrl = new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Impossible de lire le fichier"));
    reader.readAsDataURL(file);
  });

  const dataUrl = await readAsDataUrl;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const targetRatio = VINTED_PHOTO_WIDTH / VINTED_PHOTO_HEIGHT;
        const srcRatio = img.width / img.height;

        let sx, sy, sw, sh;
        if (srcRatio > targetRatio) {
          // image trop large : on rogne les côtés
          sh = img.height;
          sw = sh * targetRatio;
          sx = (img.width - sw) / 2;
          sy = 0;
        } else {
          // image trop haute : on rogne haut/bas
          sw = img.width;
          sh = sw / targetRatio;
          sx = 0;
          sy = (img.height - sh) / 2;
        }

        const canvas = document.createElement("canvas");
        canvas.width = VINTED_PHOTO_WIDTH;
        canvas.height = VINTED_PHOTO_HEIGHT;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, VINTED_PHOTO_WIDTH, VINTED_PHOTO_HEIGHT);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Échec de la génération de la photo"));
              return;
            }
            const dataUrl = canvas.toDataURL("image/jpeg", quality);
            resolve({ blob, dataUrl });
          },
          "image/jpeg",
          quality
        );
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Impossible de lire cette image"));
    img.src = dataUrl;
  });
}

// Envoie les photos au petit serveur local (server/index.js), qui porte la clé
// API OpenAI et construit le prompt métier Vinted. Le serveur renvoie déjà
// les champs JSON parsés.
async function analyzePhotos(photos) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photos }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data?.error || `Erreur API (${response.status})`);
  }

  return data.fields;
}

function Tag({ fieldKey, label, value, onChange, copied, onCopy }) {
  const isLong = fieldKey === "description";
  return (
    <div className="relative flex-shrink-0" style={{ filter: "drop-shadow(0 3px 6px rgba(0,0,0,0.35))" }}>
      <div
        className="relative rounded-[2px] px-4 pt-4 pb-3"
        style={{
          background: COLORS.paper,
          border: `1px solid ${COLORS.paperDim}`,
        }}
      >
        {/* punch hole */}
        <div
          className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full"
          style={{ background: COLORS.canvas, border: `1px solid ${COLORS.line}` }}
        />
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <span
            className="text-[10px] tracking-[0.18em] uppercase"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: COLORS.ochreDim, letterSpacing: "0.18em" }}
          >
            {label}
          </span>
          <button
            onClick={onCopy}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-sm transition-colors flex-shrink-0"
            style={{
              fontFamily: "'JetBrains Mono', monospace",
              background: copied ? "#2E4D2E" : COLORS.ink,
              color: copied ? "#B7E4B7" : COLORS.paper,
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
        {isLong ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className="w-full bg-transparent resize-none outline-none text-[14px] leading-snug"
            style={{ fontFamily: "'Bitter', serif", color: COLORS.ink, width: "260px" }}
          />
        ) : (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-transparent outline-none text-[14px]"
            style={{ fontFamily: "'Bitter', serif", color: COLORS.ink, width: "260px" }}
          />
        )}
        {/* stitched bottom edge */}
        <div
          className="mt-2 h-px w-full"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${COLORS.paperDim} 0 6px, transparent 6px 11px)`,
          }}
        />
      </div>
    </div>
  );
}

function ItemCard({ item, onUpdateField, onCopyField, onRemove, isSaved, onToggleSave, saving }) {
  const copiedKey = item.copiedKey;
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{ background: COLORS.canvasDeep, border: `1px solid ${COLORS.line}` }}
    >
      <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: `1px solid ${COLORS.line}` }}>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {item.photos.slice(0, 3).map((p, i) => (
              <img
                key={i}
                src={p.previewUrl}
                alt=""
                className="w-8 h-8 rounded-sm object-cover"
                style={{ border: `2px solid ${COLORS.canvasDeep}` }}
              />
            ))}
          </div>
          <span
            className="text-[11px] uppercase tracking-wider"
            style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A8F97" }}
          >
            {item.status === "analyzing" && "Analyse en cours…"}
            {item.status === "done" && `Fiche n°${item.index}`}
            {item.status === "error" && "Erreur d'analyse"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {item.status === "done" && (
            <button
              onClick={onToggleSave}
              disabled={saving}
              className="flex items-center gap-1 text-[11px]"
              style={{ fontFamily: "'JetBrains Mono', monospace", color: isSaved ? COLORS.ochre : "#8A8F97" }}
              title={isSaved ? "Retirer des fiches enregistrées" : "Enregistrer cette fiche pour la republier plus tard"}
            >
              {isSaved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
              {isSaved ? "Enregistrée" : "Enregistrer"}
            </button>
          )}
          <button onClick={onRemove} style={{ color: "#8A8F97" }} className="hover:text-white transition-colors">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="p-4">
        {item.status === "analyzing" && (
          <div className="flex items-center gap-2 py-6 justify-center" style={{ color: COLORS.paper }}>
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              Lecture des photos…
            </span>
          </div>
        )}
        {item.status === "error" && (
          <div className="text-sm py-4" style={{ color: "#E0A98A", fontFamily: "'Bitter', serif" }}>
            {item.error || "Impossible de générer la fiche. Réessaie."}
          </div>
        )}
        {item.status === "done" && (
          <>
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span
                  className="text-[10px] tracking-[0.18em] uppercase"
                  style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A8F97" }}
                >
                  Photos format Vinted (1080×1350)
                </span>
                {item.downloadStatus === "done" && item.downloadPhotos.length > 0 && (
                  <button
                    onClick={() => downloadAllPhotos(item)}
                    className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-sm"
                    style={{ fontFamily: "'JetBrains Mono', monospace", background: COLORS.ochre, color: COLORS.canvasDeep }}
                  >
                    <Download size={12} />
                    Télécharger le ZIP
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {item.downloadStatus === "processing" && (
                  <div className="flex items-center gap-2 text-[12px] py-2" style={{ color: "#8A8F97", fontFamily: "'JetBrains Mono', monospace" }}>
                    <Loader2 size={13} className="animate-spin" />
                    Préparation des photos…
                  </div>
                )}
                {item.downloadStatus === "error" && (
                  <div className="text-[12px] py-2" style={{ color: "#E0A98A", fontFamily: "'JetBrains Mono', monospace" }}>
                    Échec de préparation des photos
                  </div>
                )}
                {item.downloadPhotos.map((dp, i) => (
                  <div key={i} className="relative group">
                    <img src={dp.dataUrl} alt="" className="w-16 h-20 rounded-sm object-cover" />
                    <a
                      href={dp.dataUrl}
                      download={`vinted-fiche${item.index}-photo${i + 1}.jpg`}
                      className="absolute inset-0 flex items-center justify-center rounded-sm opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: "rgba(0,0,0,0.55)" }}
                    >
                      <Download size={16} color="#fff" />
                    </a>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {FIELD_ORDER.map((f) => (
                <Tag
                  key={f.key}
                  fieldKey={f.key}
                  label={f.label}
                  value={item.fields[f.key] ?? ""}
                  onChange={(v) => onUpdateField(f.key, v)}
                  copied={copiedKey === f.key}
                  onCopy={() => onCopyField(f.key)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const [items, setItems] = useState([]);
  const [pendingPhotos, setPendingPhotos] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [counter, setCounter] = useState(1);
  const [savedFiches, setSavedFiches] = useState([]);
  const [savingId, setSavingId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (auth.status !== "authenticated") return;
    loadSavedIndex()
      .then(setSavedFiches)
      .catch(() => {});
  }, [auth.status]);

  const SUPPORTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];

  const handleFiles = useCallback((fileList) => {
    const allFiles = Array.from(fileList);
    const supported = allFiles.filter((f) => SUPPORTED_TYPES.includes(f.type));
    const rejected = allFiles.filter((f) => !SUPPORTED_TYPES.includes(f.type));

    if (rejected.length > 0) {
      alert(
        "Format non supporté pour : " +
          rejected.map((f) => f.name).join(", ") +
          ".\nUtilise des photos en JPG, PNG ou WebP (pas de HEIC — sur iPhone, choisis \"Le plus compatible\" dans Réglages > Appareil photo > Formats)."
      );
    }

    const files = supported.slice(0, 4 - pendingPhotos.length);
    const withPreview = files.map((file) => ({
      id: uid(),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setPendingPhotos((prev) => [...prev, ...withPreview].slice(0, 4));
  }, [pendingPhotos.length]);

  const removePendingPhoto = (id) => {
    setPendingPhotos((prev) => prev.filter((p) => p.id !== id));
  };

  const startAnalysis = async () => {
    if (pendingPhotos.length === 0) return;
    const id = uid();
    const index = counter;
    setCounter((c) => c + 1);
    const newItem = {
      id,
      index,
      photos: pendingPhotos,
      status: "analyzing",
      fields: {},
      copiedKey: null,
      downloadPhotos: [],
      downloadStatus: "processing",
    };
    setItems((prev) => [newItem, ...prev]);
    setPendingPhotos([]);

    // Génération des photos au format Vinted (indépendante de l'analyse IA)
    Promise.all(newItem.photos.map((p, i) => fileToVintedPhoto(p.file).then((res) => ({ ...res, index: i }))))
      .then((downloadPhotos) => {
        setItems((prev) =>
          prev.map((it) => (it.id === id ? { ...it, downloadPhotos, downloadStatus: "done" } : it))
        );
      })
      .catch(() => {
        setItems((prev) => (prev.map((it) => (it.id === id ? { ...it, downloadStatus: "error" } : it))));
      });

    try {
      const preparedPhotos = await Promise.all(
        newItem.photos.map(async (p) => ({
          base64: await fileToResizedBase64(p.file),
          mediaType: "image/jpeg",
        }))
      );
      const fields = await analyzePhotos(preparedPhotos);
      applyFixedBusinessRules(fields);
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, status: "done", fields } : it)));
    } catch (err) {
      setItems((prev) =>
        prev.map((it) => (it.id === id ? { ...it, status: "error", error: err.message } : it))
      );
    }
  };

  const updateField = (itemId, key, value) => {
    setItems((prev) =>
      prev.map((it) => (it.id === itemId ? { ...it, fields: { ...it.fields, [key]: value } } : it))
    );
  };

  const copyField = (itemId, key) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;
    navigator.clipboard?.writeText(item.fields[key] ?? "").catch(() => {});
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, copiedKey: key } : it)));
    setTimeout(() => {
      setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, copiedKey: null } : it)));
    }, 1400);
  };

  const removeItem = (itemId) => setItems((prev) => prev.filter((it) => it.id !== itemId));

  const toggleSaveItem = async (item) => {
    const isSaved = savedFiches.some((e) => e.id === item.id);
    setSavingId(item.id);
    try {
      if (isSaved) {
        setSavedFiches(await deleteFicheFromStorage(item.id));
      } else {
        setSavedFiches(await saveFicheToStorage(item));
      }
    } catch (e) {
      alert("La sauvegarde a échoué. Réessaie dans un instant.");
    } finally {
      setSavingId(null);
    }
  };

  const deleteSaved = async (id) => {
    try {
      setSavedFiches(await deleteFicheFromStorage(id));
    } catch (e) {
      alert("La suppression a échoué. Réessaie dans un instant.");
    }
  };

  const reuseSaved = async (entry) => {
    try {
      const data = await fetchFicheFromStorage(entry.id);
      const index = counter;
      setCounter((c) => c + 1);
      const newItem = {
        id: entry.id,
        index,
        photos: data.photos.map((dataUrl) => ({ previewUrl: dataUrl })),
        status: "done",
        fields: data.fields,
        copiedKey: null,
        downloadPhotos: data.photos.map((dataUrl) => ({ dataUrl })),
        downloadStatus: "done",
        reusedFrom: entry.id,
      };
      setItems((prev) => [newItem, ...prev]);
    } catch (e) {
      alert("Impossible de récupérer cette fiche enregistrée.");
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  };

  if (auth.status === "checking") {
    return <div className="min-h-screen w-full" style={{ background: COLORS.canvas }} />;
  }

  if (auth.status === "unauthenticated") {
    return <LoginScreen onLogin={auth.login} />;
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{ background: COLORS.canvas, fontFamily: "'Inter', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bitter:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
      `}</style>

      {/* Header */}
      <header
        className="px-6 py-5 flex items-center justify-between"
        style={{ borderBottom: `1px solid ${COLORS.line}` }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-sm flex items-center justify-center"
            style={{ background: COLORS.ochre }}
          >
            <ClipboardList size={18} color={COLORS.canvasDeep} />
          </div>
          <div>
            <h1
              className="text-lg leading-none"
              style={{ fontFamily: "'Bitter', serif", fontWeight: 700, color: COLORS.paper }}
            >
              Fiche Express
            </h1>
            <p className="text-[11px] mt-1" style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A8F97" }}>
              Photo → fiche produit → copier-coller sur Vinted
            </p>
          </div>
        </div>
        <button
          onClick={auth.logout}
          className="flex items-center gap-1.5 text-[11px]"
          style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A8F97" }}
          title={auth.username ? `Connecté en tant que ${auth.username}` : "Déconnexion"}
        >
          <LogOut size={14} />
          Déconnexion
        </button>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 flex flex-col gap-8">
        {/* Upload zone */}
        <section>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className="rounded-md p-6 flex flex-col sm:flex-row items-center gap-5 transition-colors"
            style={{
              border: `1.5px dashed ${dragActive ? COLORS.ochre : COLORS.line}`,
              background: COLORS.canvasDeep,
            }}
          >
            <label
              htmlFor="fiche-photo-input"
              className="flex flex-col items-center justify-center gap-2 w-28 h-28 rounded-sm flex-shrink-0 transition-colors cursor-pointer"
              style={{ background: COLORS.ink, color: COLORS.paper }}
            >
              <ImagePlus size={22} />
              <span className="text-[11px]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                Ajouter
              </span>
            </label>
            <input
              id="fiche-photo-input"
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />

            <div className="flex-1 w-full">
              <p className="text-sm mb-3" style={{ fontFamily: "'Bitter', serif", color: COLORS.paper }}>
                Dépose jusqu'à 4 photos d'un même vêtement (face, dos, étiquette, détail) puis lance l'analyse.
              </p>
              {pendingPhotos.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {pendingPhotos.map((p) => (
                    <div key={p.id} className="relative">
                      <img src={p.previewUrl} alt="" className="w-14 h-14 rounded-sm object-cover" />
                      <button
                        onClick={() => removePendingPhoto(p.id)}
                        className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: COLORS.rust, color: "#fff" }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={startAnalysis}
                disabled={pendingPhotos.length === 0}
                className="flex items-center gap-1.5 text-[13px] px-4 py-2 rounded-sm transition-opacity"
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  background: pendingPhotos.length ? COLORS.ochre : COLORS.line,
                  color: pendingPhotos.length ? COLORS.canvasDeep : "#6B7076",
                  opacity: pendingPhotos.length ? 1 : 0.7,
                  cursor: pendingPhotos.length ? "pointer" : "not-allowed",
                }}
              >
                Générer la fiche
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </section>

        {/* Fiches enregistrées */}
        {savedFiches.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Library size={14} color={COLORS.ochreDim} />
              <span
                className="text-[11px] tracking-[0.18em] uppercase"
                style={{ fontFamily: "'JetBrains Mono', monospace", color: "#8A8F97" }}
              >
                Mes fiches enregistrées ({savedFiches.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-3">
              {savedFiches.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2"
                  style={{ background: COLORS.canvasDeep, border: `1px solid ${COLORS.line}` }}
                >
                  {entry.thumbnail ? (
                    <img src={entry.thumbnail} alt="" className="w-10 h-12 rounded-sm object-cover" />
                  ) : (
                    <div className="w-10 h-12 rounded-sm" style={{ background: COLORS.line }} />
                  )}
                  <div className="flex flex-col">
                    <span className="text-[13px]" style={{ fontFamily: "'Bitter', serif", color: COLORS.paper }}>
                      {entry.titre}
                    </span>
                    <span className="text-[10px]" style={{ fontFamily: "'JetBrains Mono', monospace", color: "#6B7076" }}>
                      Enregistrée le {formatSavedDate(entry.savedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => reuseSaved(entry)}
                      title="Réutiliser cette fiche (republier après une vente)"
                      className="p-1.5 rounded-sm"
                      style={{ background: COLORS.ochre, color: COLORS.canvasDeep }}
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      onClick={() => deleteSaved(entry.id)}
                      title="Supprimer cette fiche enregistrée"
                      className="p-1.5 rounded-sm"
                      style={{ background: COLORS.ink, color: "#8A8F97" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Items */}
        <section className="flex flex-col gap-4">
          {items.length === 0 && (
            <p className="text-sm text-center py-10" style={{ color: "#6B7076", fontFamily: "'Bitter', serif" }}>
              Tes fiches produit apparaîtront ici, prêtes à copier champ par champ dans Vinted.
            </p>
          )}
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onUpdateField={(key, value) => updateField(item.id, key, value)}
              onCopyField={(key) => copyField(item.id, key)}
              onRemove={() => removeItem(item.id)}
              isSaved={savedFiches.some((e) => e.id === item.id)}
              saving={savingId === item.id}
              onToggleSave={() => toggleSaveItem(item)}
            />
          ))}
        </section>
      </main>
    </div>
  );
}
