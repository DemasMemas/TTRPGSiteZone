const EFFECT_TYPE_META = {
    generic: { label: 'Общий', group: 'status' },
    heal: { label: 'Лечение', group: 'medical' },
    regeneration: { label: 'Регенерация', group: 'medical' },
    radiation: { label: 'Радиация', group: 'medical' },
    bleeding: { label: 'Кровотечение', group: 'injury' },
    bleeding_external_light: { label: 'Кровотечение внешнее лёгкое', group: 'injury' },
    bleeding_external_medium: { label: 'Кровотечение внешнее среднее', group: 'injury' },
    bleeding_external_severe: { label: 'Кровотечение внешнее сильное', group: 'injury' },
    bleeding_external_extreme: { label: 'Кровотечение внешнее экстремальное', group: 'injury' },
    bleeding_internal_light: { label: 'Кровотечение внутреннее лёгкое', group: 'injury' },
    bleeding_internal_medium: { label: 'Кровотечение внутреннее среднее', group: 'injury' },
    bleeding_internal_severe: { label: 'Кровотечение внутреннее сильное', group: 'injury' },
    bleeding_internal_extreme: { label: 'Кровотечение внутреннее экстремальное', group: 'injury' },
    pain: { label: 'Боль', group: 'injury' },
    exhaustion: { label: 'Истощение', group: 'need' },
    stress: { label: 'Стресс', group: 'mental' },
    intoxication: { label: 'Опьянение', group: 'need' },
    infection: { label: 'Заражение', group: 'disease' },
    fracture: { label: 'Перелом', group: 'injury' },
    shock: { label: 'Шок', group: 'injury' },
    unconsciousness: { label: 'Без сознания', group: 'critical' },
    critical_condition: { label: 'Критическое состояние', group: 'critical' },
    death: { label: 'Смерть', group: 'critical' },
    blindness: { label: 'Слепота', group: 'sense' },
    deafness: { label: 'Глухота', group: 'sense' },
    sleep: { label: 'Сон', group: 'critical' },
    radiation_treatment: { label: 'Выведение радиации', group: 'medical' },
    blood_recovery: { label: 'Восстановление кровопотери', group: 'medical' },
    periodic_adjustment: { label: 'Периодический эффект', group: 'status' },
    delayed_adjustment: { label: 'Отложенный эффект', group: 'status' },
    deferred_adjustment: { label: 'Отложенный эффект', group: 'status' },
    delayed_treatment: { label: 'Ожидание действия препарата', group: 'medical' },
    next_rest_healing: { label: 'Лечение на следующем отдыхе', group: 'medical' },
    untreated_wound: { label: 'Необработанная рана', group: 'injury' },
    tourniquet: { label: 'Наложен жгут', group: 'medical' },
    blood_loss_freeze: { label: 'Стабилизация кровопотери', group: 'medical' },
    bleeding_prevention: { label: 'Блок новых кровотечений', group: 'medical' },
    infection_growth_block: { label: 'Блок нарастания заражения', group: 'medical' },
    analgesia: { label: 'Обезболивание', group: 'medical' },
    stimulant_crash: { label: 'Последствие стимулятора', group: 'medical' },
    radiation_filter: { label: 'Защита от входящей радиации', group: 'medical' },
    temperature_control: { label: 'Контроль температуры', group: 'medical' },
    limb_trauma_suppression: { label: 'Подавление травмы конечности', group: 'medical' },
    pain_block: { label: 'Блок новых уровней боли', group: 'medical' },
};

const TYPE_ALIASES = {
    heal: 'heal',
    healing: 'heal',
    лечение: 'heal',
    radiation: 'radiation',
    radiaton: 'radiation',
    radiation_reduction: 'radiation',
    bleed: 'bleeding',
    bleeding: 'bleeding',
    кровотечение: 'bleeding',
    external_bleeding: 'bleeding_external_light',
    internal_bleeding: 'bleeding_internal_light',
    bleeding_external_light: 'bleeding_external_light',
    bleeding_external_medium: 'bleeding_external_medium',
    bleeding_external_severe: 'bleeding_external_severe',
    bleeding_external_extreme: 'bleeding_external_extreme',
    bleeding_internal_light: 'bleeding_internal_light',
    bleeding_internal_medium: 'bleeding_internal_medium',
    bleeding_internal_severe: 'bleeding_internal_severe',
    bleeding_internal_extreme: 'bleeding_internal_extreme',
    pain: 'pain',
    боль: 'pain',
    exhaustion: 'exhaustion',
    истощение: 'exhaustion',
    stress: 'stress',
    стресс: 'stress',
    intoxication: 'intoxication',
    опьянение: 'intoxication',
    infection: 'infection',
    заражение: 'infection',
    fracture: 'fracture',
    перелом: 'fracture',
    shock: 'shock',
    шок: 'shock',
    pain_shock: 'shock',
    'болевой шок': 'shock',
    unconsciousness: 'unconsciousness',
    unconscious: 'unconsciousness',
    безсознания: 'unconsciousness',
    critical_condition: 'critical_condition',
    критическоесостояние: 'critical_condition',
    death: 'death',
    dead: 'death',
    смерть: 'death',
    мертв: 'death',
    blindness: 'blindness',
    blind: 'blindness',
    слепота: 'blindness',
    deafness: 'deafness',
    deaf: 'deafness',
    глухота: 'deafness',
    sleep: 'sleep',
    сон: 'sleep',
    regeneration: 'regeneration',
    regen: 'regeneration',
    регенерация: 'regeneration',
    amputation: 'amputation',
    ампутация: 'amputation',
    organloss: 'organ_loss',
    organ_loss: 'organ_loss',
    потеряоргана: 'organ_loss',
    потеря_органа: 'organ_loss',
};

[
    'radiation_treatment', 'blood_recovery', 'periodic_adjustment', 'delayed_adjustment',
    'deferred_adjustment', 'delayed_treatment', 'next_rest_healing', 'untreated_wound',
    'tourniquet', 'blood_loss_freeze', 'bleeding_prevention', 'infection_growth_block',
    'analgesia', 'stimulant_crash', 'radiation_filter', 'temperature_control',
    'limb_trauma_suppression',
    'pain_block',
].forEach(type => { TYPE_ALIASES[type] = type; });

const STATUS_EFFECT_TYPES = new Set([
    'bleeding',
    'pain',
    'exhaustion',
    'stress',
    'intoxication',
    'infection',
    'fracture',
    'shock',
    'unconsciousness',
    'critical_condition',
    'death',
    'blindness',
    'deafness',
    'sleep',
    'amputation',
    'organ_loss',
    'bleeding_external_light',
    'bleeding_external_medium',
    'bleeding_external_severe',
    'bleeding_external_extreme',
    'bleeding_internal_light',
    'bleeding_internal_medium',
    'bleeding_internal_severe',
    'bleeding_internal_extreme',
]);

const BLEEDING_STAGE_ORDER = ['normal', 'light', 'medium', 'severe', 'critical'];
const BLEEDING_STAGE_PENALTIES = {
    normal: 0,
    light: 1,
    medium: 2,
    severe: 3,
    critical: 4,
};

const BLEEDING_EFFECT_RULES = {
    bleeding: { severity: 1, kind: 'external', stage: 'light', areas: ['wound'] },
    bleeding_external_light: { severity: 1, kind: 'external', stage: 'light', areas: ['wound'] },
    bleeding_external_medium: { severity: 3, kind: 'external', stage: 'medium', areas: ['wound'] },
    bleeding_external_severe: { severity: 5, kind: 'external', stage: 'severe', areas: ['wound'] },
    bleeding_external_extreme: { severity: 8, kind: 'external', stage: 'extreme', areas: ['wound'] },
    bleeding_internal_light: { severity: 1, kind: 'internal', stage: 'light', areas: ['wound'] },
    bleeding_internal_medium: { severity: 3, kind: 'internal', stage: 'medium', areas: ['wound'] },
    bleeding_internal_severe: { severity: 5, kind: 'internal', stage: 'severe', areas: ['wound'] },
    bleeding_internal_extreme: { severity: 8, kind: 'internal', stage: 'extreme', areas: ['wound'] },
};

const EFFECT_IMPACT_RULES = {
    generic: { areas: [], requiresMedicineCheck: false, treatment: 'manual' },
    heal: { areas: ['whole_body'], requiresMedicineCheck: false, treatment: 'oral_or_medical' },
    regeneration: { areas: ['whole_body'], requiresMedicineCheck: false, treatment: 'medical' },
    radiation: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_external_light: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_external_medium: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_external_severe: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_external_extreme: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_internal_light: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_internal_medium: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_internal_severe: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    bleeding_internal_extreme: { areas: ['wound'], requiresMedicineCheck: true, treatment: 'medical' },
    pain: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    exhaustion: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    stress: { areas: ['whole_body', 'mind'], requiresMedicineCheck: true, treatment: 'medical' },
    intoxication: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    infection: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    fracture: { areas: ['limb'], requiresMedicineCheck: true, treatment: 'medical' },
    shock: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    unconsciousness: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    critical_condition: { areas: ['whole_body'], requiresMedicineCheck: true, treatment: 'medical' },
    death: { areas: ['whole_body'], requiresMedicineCheck: false, treatment: 'none' },
    blindness: { areas: ['eyes', 'vision', 'head'], requiresMedicineCheck: true, treatment: 'medical' },
    deafness: { areas: ['ears', 'hearing', 'head'], requiresMedicineCheck: true, treatment: 'medical' },
    sleep: { areas: ['whole_body', 'mind'], requiresMedicineCheck: false, treatment: 'rest' },
    amputation: { areas: ['missing_limb'], requiresMedicineCheck: true, treatment: 'medical' },
    organ_loss: { areas: ['missing_organ'], requiresMedicineCheck: true, treatment: 'medical' },
};

function toInt(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = null) {
    let result = value;
    if (min !== null) result = Math.max(min, result);
    if (max !== null) result = Math.min(max, result);
    return result;
}

function canonicalType(type, name = '') {
    const raw = String(type || name || '').trim().toLowerCase();
    if (!raw) return 'generic';
    if (TYPE_ALIASES[raw]) return TYPE_ALIASES[raw];

    const compact = raw.replace(/[\s_-]+/g, '');
    if (TYPE_ALIASES[compact]) return TYPE_ALIASES[compact];

    if (raw.includes('внутрен') && raw.includes('кров')) {
        if (raw.includes('экстрем')) return 'bleeding_internal_extreme';
        if (raw.includes('сильн')) return 'bleeding_internal_severe';
        if (raw.includes('средн')) return 'bleeding_internal_medium';
        if (raw.includes('легк') || raw.includes('лёгк')) return 'bleeding_internal_light';
        return 'bleeding_internal_light';
    }
    if (raw.includes('внешн') && raw.includes('кров')) {
        if (raw.includes('экстрем')) return 'bleeding_external_extreme';
        if (raw.includes('сильн')) return 'bleeding_external_severe';
        if (raw.includes('средн')) return 'bleeding_external_medium';
        if (raw.includes('легк') || raw.includes('лёгк')) return 'bleeding_external_light';
        return 'bleeding_external_light';
    }
    if (raw.includes('кров')) return 'bleeding';
    if (raw.includes('радиа')) return 'radiation';
    if (raw.includes('истощ')) return 'exhaustion';
    if (raw.includes('стресс')) return 'stress';
    if (raw.includes('опьян')) return 'intoxication';
    if (raw.includes('перелом')) return 'fracture';
    if (raw.includes('боль')) return 'pain';
    if (raw.includes('шок')) return 'shock';
    if (raw.includes('критичес')) return 'critical_condition';
    if (raw.includes('смерт') || raw.includes('мертв')) return 'death';
    if (raw.includes('слеп')) return 'blindness';
    if (raw.includes('глух')) return 'deafness';
    if (raw.includes('зараж')) return 'infection';
    if (raw.includes('лечение') || raw.includes('heal')) return 'heal';
    if (raw.includes('реген')) return 'regeneration';
    if (raw.includes('ампута')) return 'amputation';
    if (raw.includes('орган') && raw.includes('потер')) return 'organ_loss';

    return 'generic';
}

function getEffectMeta(type) {
    return EFFECT_TYPE_META[type] || EFFECT_TYPE_META.generic;
}

function getBleedingRule(type) {
    return Object.prototype.hasOwnProperty.call(BLEEDING_EFFECT_RULES, type)
        ? BLEEDING_EFFECT_RULES[type]
        : null;
}

function getBleedingStageValue(stage) {
    const index = BLEEDING_STAGE_ORDER.indexOf(String(stage || 'normal').toLowerCase());
    return index >= 0 ? index : 0;
}

function getBleedingState(health = {}) {
    const effects = normalizeEffectList(Array.isArray(health.effects) ? health.effects : []);
    const combatMeta = health.combatMeta || {};
    const breakdown = {
        external: { light: 0, medium: 0, severe: 0, extreme: 0, total: 0 },
        internal: { light: 0, medium: 0, severe: 0, extreme: 0, total: 0 },
    };
    const effectDetails = [];
    let totalSeverity = 0;

    effects.forEach((effect) => {
        const rule = getBleedingRule(effect.type);
        if (!rule || effect.active === false || effect.closed || effect.suppressed) return;
        const stacks = Math.max(1, toInt(effect.stacks, 1));
        const baseSeverity = Math.max(1, toInt(effect.value, rule.severity || 1));
        const resolvedSeverity = Math.max(rule.severity || 1, baseSeverity) * stacks;
        const group = rule.kind || 'external';
        const stage = rule.stage || 'light';
        if (!breakdown[group]) return;
        breakdown[group][stage] = (breakdown[group][stage] || 0) + stacks;
        breakdown[group].total += resolvedSeverity;
        totalSeverity += resolvedSeverity;
        effectDetails.push({
            id: effect.id,
            type: effect.type,
            name: effect.name || getEffectMeta(effect.type).label,
            kind: group,
            stage,
            severity: resolvedSeverity,
            stacks,
            area: effect.area || null,
            treated: Boolean(effect.treated),
        });
    });

    const bloodStage = String(health.blood || health.bloodStage || 'normal').toLowerCase();
    const stagePenalty = getBleedingStageValue(bloodStage);
    const modifierTotal = Array.isArray(combatMeta.bleedingModifiers)
        ? combatMeta.bleedingModifiers.reduce((sum, item) => sum + toInt(item?.value ?? item, 0), 0)
        : toInt(combatMeta.bleedingModifierTotal ?? health.bleedingModifierTotal ?? 0, 0);
    return {
        baseDifficulty: 5,
        totalSeverity,
        bloodStage,
        stagePenalty,
        modifierTotal,
        difficulty: Math.max(0, 5 + totalSeverity - stagePenalty + modifierTotal),
        breakdown,
        effects: effectDetails,
    };
}

export function syncHealthDerivedStatuses(health = {}) {
    if (!health || typeof health !== 'object') return health;
    const bleeding = getBleedingState(health);
    health.bleeding = bleeding;
    health.bleedingSeverity = bleeding.totalSeverity;
    health.bleedingDifficulty = bleeding.difficulty;
    health.bleedingStagePenalty = bleeding.stagePenalty;
    health.bleedingModifierTotal = bleeding.modifierTotal;
    health.bloodStage = bleeding.bloodStage;
    health.bleedingEffects = bleeding.effects;
    return health;
}

export function getEffectTypeOptions() {
    return Object.entries(EFFECT_TYPE_META).map(([value, meta]) => ({
        value,
        label: meta.label,
        group: meta.group,
    }));
}

export function normalizeEffect(raw = {}) {
    if (raw === null || raw === undefined) {
        return createEffectDraft('generic');
    }
    if (typeof raw === 'string') {
        return createEffectDraft(canonicalType(raw, raw), { name: raw });
    }
    if (typeof raw !== 'object') {
        return createEffectDraft('generic', { value: raw });
    }

    const name = String(raw.name || raw.label || '').trim();
    const type = canonicalType(raw.type || raw.kind || raw.effectType, name);
    const value = raw.value ?? raw.amount ?? raw.power ?? 0;
    const duration = raw.duration ?? raw.turns ?? raw.remaining ?? null;

    const normalized = {
        id: raw.id || null,
        type,
        name: name || getEffectMeta(type).label,
        value: Number.isFinite(Number(value)) ? Number(value) : 0,
        duration: duration === null || duration === '' ? null : toInt(duration, null),
        remaining: raw.remaining === undefined || raw.remaining === null || raw.remaining === '' ? null : toInt(raw.remaining, null),
        stacks: raw.stacks === undefined || raw.stacks === null ? 1 : Math.max(1, toInt(raw.stacks, 1)),
        source: raw.source || raw.origin || null,
        note: raw.note || raw.description || '',
        tick: raw.tick || raw.tickPhase || 'manual',
        scope: raw.scope || 'character',
        active: raw.active !== false,
        area: raw.area || raw.zone || raw.bodyPart || raw.target || null,
    };
    Object.entries(raw).forEach(([key, entryValue]) => {
        if (!['type', 'kind', 'effectType', 'turns', 'tickPhase', 'zone', 'bodyPart', 'target'].includes(key)
            && normalized[key] === undefined) {
            normalized[key] = entryValue;
        }
    });
    if (['', 'общий', 'generic'].includes(String(normalized.name || '').trim().toLowerCase()) && type !== 'generic') {
        normalized.name = getEffectMeta(type).label;
    }
    const maxHours = toInt(normalized.max_hours, 0);
    if (normalized.remaining === null && maxHours > 0) {
        normalized.remaining = maxHours;
        normalized.duration = normalized.duration ?? maxHours;
        normalized.time_unit = 'hour';
    }
    return normalized;
}

export function normalizeEffectList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(normalizeEffect);
}

export function createEffectDraft(type = 'generic', overrides = {}) {
    const effectType = canonicalType(type, overrides.name || '');
    const meta = getEffectMeta(effectType);
    return {
        id: overrides.id || `effect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: effectType,
        name: overrides.name || meta.label,
        value: overrides.value ?? 0,
        duration: overrides.duration ?? null,
        remaining: overrides.remaining ?? (overrides.duration ?? null),
        stacks: overrides.stacks ?? 1,
        source: overrides.source || null,
        area: overrides.area || overrides.zone || overrides.bodyPart || overrides.target || null,
        note: overrides.note || '',
        tick: overrides.tick || 'manual',
        scope: overrides.scope || 'character',
        active: overrides.active !== false,
    };
}

function upsertStatusEffect(health, effect) {
    if (!Array.isArray(health.effects)) {
        health.effects = [];
    }

    const existingIndex = health.effects.findIndex(item => {
        const current = normalizeEffect(item);
        if (effect.id && current.id === effect.id) return true;
        if (String(effect.type || '').startsWith('bleeding_')) return false;
        return current.type === effect.type
            && (current.source || null) === (effect.source || null)
            && (current.area || null) === (effect.area || null);
    });

    if (existingIndex >= 0) {
        const current = normalizeEffect(health.effects[existingIndex]);
        health.effects[existingIndex] = {
            ...current,
            ...effect,
            stacks: Math.max(current.stacks || 1, effect.stacks || 1),
            remaining: effect.remaining !== null ? effect.remaining : current.remaining,
            active: effect.active !== false && current.active !== false,
        };
    } else {
        health.effects.push(effect);
    }
}

function adjustHealthField(health, field, delta, min = 0, max = null) {
    const current = toInt(health[field], 0);
    health[field] = clamp(current + delta, min, max);
}

function distributeZoneHealing(health, amount) {
    let remaining = Math.max(0, Math.floor(Number(amount) || 0));
    const zones = Object.values(health.zones || {}).filter(zone => zone && typeof zone === 'object');
    zones.forEach((zone) => {
        const maximum = Math.max(0, Math.round(Number(zone.max || 0)));
        zone.current = Math.min(maximum, Math.max(0, Math.round(Number(zone.current || 0))));
    });
    while (remaining > 0) {
        const damaged = zones.filter(zone => Number(zone.current || 0) < Number(zone.max || 0));
        if (!damaged.length) break;
        const share = Math.floor(remaining / damaged.length);
        if (share === 0) {
            damaged.slice(0, remaining).forEach((zone) => {
                zone.current += 1;
            });
            break;
        }
        let applied = 0;
        damaged.forEach((zone) => {
            const current = Number(zone.current || 0);
            const maximum = Number(zone.max || 0);
            const healed = Math.min(share, maximum - current);
            zone.current = current + healed;
            applied += healed;
        });
        if (applied <= 0) break;
        remaining -= applied;
    }
}

function healHealthAndZones(health, amount) {
    adjustHealthField(health, 'current', amount, 0, health.max ?? null);
    distributeZoneHealing(health, amount);
}

export function applyEffectToHealth(healthInput = {}, rawEffect = {}) {
    const health = healthInput;
    const effect = normalizeEffect(rawEffect);
    const signedValue = Number(effect.value);
    const magnitude = Math.abs(Number.isFinite(signedValue) ? signedValue : toInt(effect.value, 0));
    const activeEffects = normalizeEffectList(health.effects || []);
    if (String(effect.type || '').startsWith('bleeding_')
        && activeEffects.some(item => item.type === 'bleeding_prevention' && item.active !== false)) {
        return { health, effect, applied: false, summary: 'bleeding_blocked' };
    }

    if (effect.type === 'heal') {
        healHealthAndZones(health, magnitude);
        return { health, effect, applied: true, summary: `heal:${magnitude}` };
    }

    if (effect.type === 'regeneration') {
        upsertStatusEffect(health, effect);
        syncHealthDerivedStatuses(health);
        return { health, effect, applied: true, summary: `regeneration:${magnitude}` };
    }

    if (effect.type === 'radiation') {
        adjustHealthField(health, 'radiation', Number.isFinite(signedValue) ? signedValue : -magnitude, 0, null);
        return { health, effect, applied: true, summary: `radiation:-${magnitude}` };
    }

    if (effect.type === 'pain') {
        if (signedValue > 0 && activeEffects.some(item => item.blocks_new_pain && item.active !== false)) {
            health.combatMeta = health.combatMeta || {};
            health.combatMeta.blockedPain = Number(health.combatMeta.blockedPain || 0) + signedValue;
            return { health, effect, applied: false, summary: 'pain_blocked' };
        }
        adjustHealthField(health, 'painLevel', Number.isFinite(signedValue) ? signedValue : magnitude, 0, 10);
        health.combatMeta = health.combatMeta || {};
        health.combatMeta.painIncreased = true;
        return { health, effect, applied: true, summary: `pain:+${magnitude}` };
    }

    if (effect.type === 'exhaustion') {
        adjustHealthField(health, 'exhaustion', Number.isFinite(signedValue) ? signedValue : magnitude, 0, 10);
        return { health, effect, applied: true, summary: `exhaustion:+${magnitude}` };
    }

    if (effect.type === 'stress') {
        adjustHealthField(health, 'stress', Number.isFinite(signedValue) ? signedValue : magnitude, 0, 10);
        return { health, effect, applied: true, summary: `stress:+${magnitude}` };
    }

    if (effect.type === 'intoxication') {
        adjustHealthField(health, 'intoxication', Number.isFinite(signedValue) ? signedValue : magnitude, 0, 100);
        return { health, effect, applied: true, summary: `intoxication:+${magnitude}` };
    }

    if (effect.type === 'infection') {
        adjustHealthField(health, 'infection', Number.isFinite(signedValue) ? signedValue : magnitude, 0, 100);
        syncHealthDerivedStatuses(health);
        return { health, effect, applied: true, summary: `infection:+${magnitude}` };
    }

    if (effect.type === 'bleeding' || effect.type === 'fracture' || effect.type === 'shock' || effect.type === 'unconsciousness' || effect.type === 'critical_condition' || effect.type === 'death' || effect.type === 'blindness' || effect.type === 'deafness' || effect.type === 'bleeding_external_light' || effect.type === 'bleeding_external_medium' || effect.type === 'bleeding_external_severe' || effect.type === 'bleeding_external_extreme' || effect.type === 'bleeding_internal_light' || effect.type === 'bleeding_internal_medium' || effect.type === 'bleeding_internal_severe' || effect.type === 'bleeding_internal_extreme') {
        upsertStatusEffect(health, effect);
        syncHealthDerivedStatuses(health);
        return { health, effect, applied: true, summary: effect.type };
    }

    upsertStatusEffect(health, effect);
    syncHealthDerivedStatuses(health);
    return { health, effect, applied: true, summary: effect.type };
}

export function isAlcoholConsumable(item = {}) {
    const direct = item?.attributes?.consumable?.direct || {};
    if (item?.attributes?.is_alcohol === true
        || item?.attributes?.alcohol === true
        || direct.is_alcohol === true) return true;
    const section = String(item?.attributes?.section || item?.subcategory || '').trim().toLowerCase();
    if (section === 'продукты' && Number(direct.intoxication_delta || 0) > 0) return true;
    return /водка|самогон|вино|пиво|алкогол/i.test(String(item?.name || ''));
}

export function normalizeCharacterEffects(characterData = {}) {
    if (!characterData || typeof characterData !== 'object') return characterData;
    if (characterData.health && Array.isArray(characterData.health.effects)) {
        characterData.health.effects = normalizeEffectList(characterData.health.effects);
        syncHealthDerivedStatuses(characterData.health);
    }
    if (Array.isArray(characterData.effects)) {
        characterData.effects = normalizeEffectList(characterData.effects);
    }
    return characterData;
}

export function tickEffect(effect, phase = 'turn_end') {
    const normalized = normalizeEffect(effect);
    if (!normalized.active) return normalized;
    if (normalized.tick === 'manual' || (normalized.tick && normalized.tick !== phase)) {
        return normalized;
    }

    if (normalized.remaining !== null && normalized.remaining !== undefined) {
        normalized.remaining = Math.max(0, toInt(normalized.remaining, 0) - 1);
    }

    return normalized;
}

export function advanceTimedEffects(health = {}, effectsInput = [], elapsedSeconds = 0, includeTurnEffects = false) {
    const unitSeconds = { second: 1, minute: 60, movement: 600, hour: 3600 };
    const survivors = [];
    const activated = [];
    const adjust = (entry) => {
        if (!entry?.field) return;
        const min = entry.min ?? 0;
        const max = entry.max ?? null;
        let value = Number(health[entry.field] || 0) + Number(entry.delta || 0);
        if (min !== null) value = Math.max(Number(min), value);
        if (max !== null) value = Math.min(Number(max), value);
        health[entry.field] = value;
    };

    normalizeEffectList(effectsInput).forEach(effect => {
        let unit = String(effect.time_unit || '').toLowerCase();
        if (effect.remaining == null && Number(effect.max_hours || 0) > 0) {
            effect.remaining = Number(effect.max_hours);
            effect.time_unit = 'hour';
            unit = 'hour';
        }
        if (!unit) {
            unit = {
                time_elapsed: 'minute',
                movement_end: 'movement',
                hour_start: 'hour',
            }[effect.tick] || '';
        }
        if (includeTurnEffects && !unit && effect.tick === 'turn_end') {
            unit = 'second';
            effect.seconds_per_unit ??= 6;
        }
        if (!unitSeconds[unit] || effect.remaining == null) {
            survivors.push(effect);
            return;
        }
        const secondsPerUnit = Math.max(0.001, Number(effect.seconds_per_unit || unitSeconds[unit]));
        const remainingSeconds = Number(
            effect.remaining_seconds ?? (Number(effect.remaining) * secondsPerUnit)
        ) - Math.max(0, Number(elapsedSeconds) || 0);
        if (remainingSeconds > 0) {
            effect.remaining_seconds = remainingSeconds;
            effect.remaining = Math.max(1, Math.ceil(remainingSeconds / secondsPerUnit));
            survivors.push(effect);
            return;
        }
        (effect.onExpire || effect.on_expire || []).forEach(adjust);
        if (['delayed_adjustment', 'delayed_treatment', 'deferred_adjustment'].includes(effect.type)) {
            (effect.adjustments || []).forEach(adjust);
        }
        activated.push(...(effect.activate_effects || effect.activateEffects || []).filter(
            entry => entry && typeof entry === 'object'
        ));
    });
    const modifiers = health.combatMeta?.consumableModifiers;
    if (Array.isArray(modifiers)) {
        health.combatMeta.consumableModifiers = modifiers.filter(modifier => {
            if (!modifier || typeof modifier !== 'object' || modifier.remaining == null) return true;
            let unit = String(modifier.time_unit || '').toLowerCase();
            const tick = String(modifier.tick || 'turn_end');
            if (!unit) {
                unit = {
                    turn_end: 'second',
                    time_elapsed: 'minute',
                    movement_end: 'movement',
                    hour_start: 'hour',
                }[tick] || '';
            }
            if (!unitSeconds[unit]) return true;
            const secondsPerUnit = Math.max(
                0.001,
                Number(modifier.seconds_per_unit || (tick === 'turn_end' ? 6 : unitSeconds[unit]))
            );
            const remainingSeconds = Number(
                modifier.remaining_seconds ?? (Number(modifier.remaining) * secondsPerUnit)
            ) - Math.max(0, Number(elapsedSeconds) || 0);
            if (remainingSeconds <= 0) return false;
            modifier.remaining_seconds = remainingSeconds;
            modifier.remaining = Math.max(1, Math.ceil(remainingSeconds / secondsPerUnit));
            return true;
        });
    }
    health.effects = survivors;
    activated.forEach(effect => applyEffectToHealth(health, effect));
    syncHealthDerivedStatuses(health);
    return normalizeEffectList(health.effects || []);
}

function getEffectImpact(effect) {
    const normalized = normalizeEffect(effect);
    const rule = EFFECT_IMPACT_RULES[normalized.type] || EFFECT_IMPACT_RULES.generic;
    const areas = new Set(rule.areas || []);
    if (normalized.area) areas.add(normalized.area);
    const bleedingRule = getBleedingRule(normalized.type);
    return {
        type: normalized.type,
        name: normalized.name,
        areas: Array.from(areas),
        requiresMedicineCheck: !!rule.requiresMedicineCheck,
        treatment: rule.treatment || 'manual',
        severity: bleedingRule ? Math.max(1, toInt(normalized.value, bleedingRule.severity || 1)) : null,
        bleedingKind: bleedingRule ? bleedingRule.kind : null,
    };
}

export function summarizeEffectImpact(effect) {
    const impact = getEffectImpact(effect);
    const areas = impact.areas.length ? impact.areas.join(', ') : 'нет';
    const treatment = impact.requiresMedicineCheck ? 'требует Медицины' : 'без проверки';
    const bleedingPart = impact.bleedingKind ? `${impact.bleedingKind} ${impact.severity || 1}` : '';
    return `${impact.name}${bleedingPart ? `: ${bleedingPart}` : ''}${areas ? `, ${areas}` : ''} (${treatment})`;
}

export function applyPeriodicEffectsToHealth(healthInput = {}, effectsInput = [], phase = 'turn_end') {
    const health = healthInput;
    const effects = normalizeEffectList(effectsInput);
    const applied = [];
    effects.forEach((rawEffect) => {
        const effect = normalizeEffect(rawEffect);
        if (!effect.active) return;
        if (effect.tick && effect.tick !== 'manual' && effect.tick !== phase) return;

        const magnitude = Math.abs(toInt(effect.value, 0));
        if (effect.type === 'regeneration') {
            healHealthAndZones(health, magnitude);
            applied.push({ type: 'regeneration', delta: magnitude });
        }
    });
    syncHealthDerivedStatuses(health);
    return { health, effects, applied };
}

export function effectSummary(effect) {
    const normalized = normalizeEffect(effect);
    const parts = [normalized.name || getEffectMeta(normalized.type).label];
    if (normalized.value) parts.push(`+${normalized.value}`);
    if (normalized.remaining !== null && normalized.remaining !== undefined) parts.push(`${normalized.remaining}t`);
    return parts.join(' ');
}
