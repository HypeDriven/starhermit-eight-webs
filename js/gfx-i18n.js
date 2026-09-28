// Eight Webs — strings for the Settings button and Graphics panel in the nine
// supported locales. The rest of the game is English-only (spec §10); these
// panel strings follow navigator.language with an en-US fallback.

const EN = {
  settings: 'Settings', close: 'Close', graphics: 'Graphics',
  quality: 'Quality', auto: 'Auto (detected: {tier})', fromPreset: 'From preset ({tier})',
  renderScale: 'Render scale', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device; effects that need it are off.',
  noWebgl: '3D view unavailable: only card finish settings apply.',
  presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
  cats: {
    shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade',
    antialias: 'Anti-aliasing', reflections: 'Reflections', particles: 'Particles',
    background: 'Table ambience', detail: 'Surface detail',
  },
  tiers: {
    off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Still', animated: 'Animated',
    plain: 'Plain', detailed: 'Detailed',
  },
};

const US = { ...EN, cats: { ...EN.cats, grade: 'Color grade' } };

const ES = {
  settings: 'Ajustes', close: 'Cerrar', graphics: 'Gráficos',
  quality: 'Calidad', auto: 'Automática (detectada: {tier})', fromPreset: 'Según el ajuste ({tier})',
  renderScale: 'Escala de render', adaptive: 'Resolución adaptativa', showFps: 'Mostrar FPS',
  postFailed: 'El posprocesado no está disponible en este dispositivo; los efectos que lo necesitan están desactivados.',
  noWebgl: 'Vista 3D no disponible: solo se aplica el acabado de las cartas.',
  presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Gradación de color',
    antialias: 'Antialiasing', reflections: 'Reflejos', particles: 'Partículas',
    background: 'Ambiente de la mesa', detail: 'Detalle de superficies',
  },
  tiers: {
    off: 'No', on: 'Sí', low: 'Bajo', medium: 'Medio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Estático', animated: 'Animado',
    plain: 'Simple', detailed: 'Detallado',
  },
};
const ES419 = { ...ES, settings: 'Configuración', renderScale: 'Escala de renderizado' };

const DE = {
  settings: 'Einstellungen', close: 'Schließen', graphics: 'Grafik',
  quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})', fromPreset: 'Laut Voreinstellung ({tier})',
  renderScale: 'Renderskalierung', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
  postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte, die sie brauchen, sind aus.',
  noWebgl: '3D-Ansicht nicht verfügbar: Nur die Kartenoptik wird angewendet.',
  presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
  cats: {
    shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur',
    antialias: 'Kantenglättung', reflections: 'Spiegelungen', particles: 'Partikel',
    background: 'Tischatmosphäre', detail: 'Oberflächendetails',
  },
  tiers: {
    off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Ruhig', animated: 'Animiert',
    plain: 'Schlicht', detailed: 'Detailliert',
  },
};

const FR = {
  settings: 'Paramètres', close: 'Fermer', graphics: 'Graphismes',
  quality: 'Qualité', auto: 'Auto (détecté : {tier})', fromPreset: 'Selon le préréglage ({tier})',
  renderScale: 'Échelle de rendu', adaptive: 'Résolution adaptative', showFps: 'Afficher les IPS',
  postFailed: 'Le post-traitement est indisponible sur cet appareil ; les effets qui en dépendent sont désactivés.',
  noWebgl: 'Vue 3D indisponible : seule la finition des cartes s’applique.',
  presets: { low: 'Faible', balanced: 'Équilibrée', high: 'Élevée', ultra: 'Ultra' },
  cats: {
    shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Lueur', grade: 'Étalonnage',
    antialias: 'Anticrénelage', reflections: 'Reflets', particles: 'Particules',
    background: 'Ambiance de la table', detail: 'Détail des surfaces',
  },
  tiers: {
    off: 'Non', on: 'Oui', low: 'Faible', medium: 'Moyen', high: 'Élevé',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Fixe', animated: 'Animé',
    plain: 'Simple', detailed: 'Détaillé',
  },
};
const FRCA = { ...FR, showFps: 'Afficher les images/s', cats: { ...FR.cats, antialias: 'Antialiasing' } };

const PT = {
  settings: 'Configurações', close: 'Fechar', graphics: 'Gráficos',
  quality: 'Qualidade', auto: 'Automática (detectada: {tier})', fromPreset: 'Da predefinição ({tier})',
  renderScale: 'Escala de renderização', adaptive: 'Resolução adaptativa', showFps: 'Mostrar FPS',
  postFailed: 'O pós-processamento não está disponível neste dispositivo; os efeitos que dependem dele estão desligados.',
  noWebgl: 'Visão 3D indisponível: só o acabamento das cartas é aplicado.',
  presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor',
    antialias: 'Antisserrilhamento', reflections: 'Reflexos', particles: 'Partículas',
    background: 'Ambiente da mesa', detail: 'Detalhe das superfícies',
  },
  tiers: {
    off: 'Desligado', on: 'Ligado', low: 'Baixo', medium: 'Médio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Estático', animated: 'Animado',
    plain: 'Simples', detailed: 'Detalhado',
  },
};

const IT = {
  settings: 'Impostazioni', close: 'Chiudi', graphics: 'Grafica',
  quality: 'Qualità', auto: 'Automatica (rilevata: {tier})', fromPreset: 'Da preimpostazione ({tier})',
  renderScale: 'Scala di rendering', adaptive: 'Risoluzione adattiva', showFps: 'Mostra FPS',
  postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti che la richiedono sono disattivati.',
  noWebgl: 'Vista 3D non disponibile: si applica solo la finitura delle carte.',
  presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
  cats: {
    shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
    antialias: 'Antialiasing', reflections: 'Riflessi', particles: 'Particelle',
    background: 'Atmosfera del tavolo', detail: 'Dettaglio superfici',
  },
  tiers: {
    off: 'No', on: 'Sì', low: 'Basso', medium: 'Medio', high: 'Alto',
    fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', static: 'Fisso', animated: 'Animato',
    plain: 'Semplice', detailed: 'Dettagliato',
  },
};

export const GFX_STRINGS = {
  'en-US': US, 'en-GB': EN, 'es-419': ES419, 'es-ES': ES, 'de-DE': DE,
  'fr-FR': FR, 'fr-CA': FRCA, 'pt-BR': PT, 'it-IT': IT,
};

/** Pick the closest supported locale for a BCP-47 tag (en-US fallback). */
export function pickLocale(tag) {
  const t = String(tag || '').replace('_', '-');
  const exact = Object.keys(GFX_STRINGS).find((k) => k.toLowerCase() === t.toLowerCase());
  if (exact) return exact;
  const [lang, region = ''] = t.toLowerCase().split('-');
  if (lang === 'en') return ['gb', 'uk', 'ie', 'au', 'nz'].includes(region) ? 'en-GB' : 'en-US';
  if (lang === 'es') return region === 'es' ? 'es-ES' : 'es-419';
  if (lang === 'fr') return region === 'ca' ? 'fr-CA' : 'fr-FR';
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'de') return 'de-DE';
  if (lang === 'it') return 'it-IT';
  return 'en-US';
}

export function gfxStrings(tag = (typeof navigator !== 'undefined' ? navigator.language : 'en-US')) {
  return GFX_STRINGS[pickLocale(tag)];
}

export function fmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? '');
}
