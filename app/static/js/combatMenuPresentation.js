// Presentation only. Fixed prices come from the server's available_actions catalog;
// selectors keep their own calculation after the player chooses a target/payment.
const RESOURCE_FIELDS = [
    ['action_points', 'action_points_current', 'ОД'],
    ['free_actions', 'free_actions_current', 'СД'],
    ['movement_points', 'movement_points_current', 'ОП'],
];
const SELECTOR_COSTS = {
    movement: ['', 'Стоимость зависит от маршрута и типа движения.'],
    attack: ['', 'Стоимость определяется оружием и способом атаки после выбора.'],
    medical: ['', 'Стоимость зависит от расходника, процедуры и доставания предмета.'],
    posture: ['', 'Стоимость зависит от текущего положения, нового положения и способа оплаты.'],
    facing: ['', 'Стоимость зависит от угла, положения и способа оплаты.'],
    interaction: ['', 'Доступные действия и стоимость определяются после выбора цели.'],
    melee: ['', 'Выберите приём: его стоимость указана в меню ближнего боя.'],
    gunpoint: ['', 'Нужно заряженное огнестрельное оружие в руках и цель на соседней клетке.'],
    narrative: ['', 'Стоимость задаётся при описании действия; возможна оплата в несколько ходов.'],
    help: ['', 'ОД задаются в заявке. Недостающие ОД можно оплатить в следующем ходу.'],
    reaction: ['Резерв', 'Выберите резерв ОД, СД и ОП. В чужой ход требуется разрешение ведущего.'],
    reserved_reaction: ['Резерв', 'Запросить разрешение ведущего на использование сохранённого резерва.'],
};

export function combatMenuPresentation({ item, actor, catalog = [], active, controlled, currentTurn, condition, allowed, reactionInProgress }) {
    let reason = '';
    let cost = '';
    let tooltipCost = '';
    let detail = item.title || '';
    if (!allowed) {
        if (!item.allowAlways && !controlled) reason = 'Нет разрешения управлять этим персонажем.';
        else if (item.requiresCombat && !active) reason = 'Действие доступно только в бою.';
        else if (condition.state !== 'active' && !item.allowAlways && !item.allowIncapacitated) reason = condition.label || 'Состояние персонажа не позволяет действовать.';
        else if (!currentTurn) reason = 'Сейчас ход другого персонажа.';
        else reason = 'Действие сейчас недоступно этому персонажу.';
    }
    const selector = SELECTOR_COSTS[item.key];
    if (selector) {
        cost = active ? selector[0] : '';
        detail += ` ${selector[1]}`;
    }
    const action = catalog.find(entry => entry.key === item.actionKey);
    if (active && action) {
        if (item.actionKey === 'convert_free_action_to_movement') {
            // The server spends SD first, otherwise OD; these are alternatives.
            const free = Number(action.free_actions), points = Number(action.action_points);
            const alternatives = `${free} СД или ${points} ОД`;
            cost = Number(actor?.free_actions_current) >= free ? `${free} СД` : `${points} ОД`;
            tooltipCost = alternatives;
            if (!reason && Number(actor?.free_actions_current || 0) < free && Number(actor?.action_points_current || 0) < points)
                reason = 'Недостаточно ресурсов.';
        } else {
            const payments = RESOURCE_FIELDS.filter(([key]) => Number(action[key]) > 0);
            cost = payments.map(([key, , label]) => `${action[key]} ${label}`).join(' + ') || '0 ОД';
            const missing = payments.filter(([key, field]) => Number(actor?.[field] || 0) < Number(action[key]));
            if (!reason && missing.length) reason = 'Недостаточно ресурсов.';
        }
    } else if (active && item.actionKey) {
        cost = 'Уточняется';
        detail += ' Стоимость пока не получена от сервера.';
    }
    if (item.actionKey === 'must_do_it') cost = '1 стресс';
    if (item.conditions) detail += `\n${item.conditions}`;
    if (item.actionKey === 'recover_from_shock') {
        detail += ' Попытка завершает ход.';
        if (!reason && condition.can_recover === false) reason = 'Сначала снизьте боль до 9 или ниже.';
    }
    if (!reason && item.key === 'reaction' && !['action_points_current', 'free_actions_current', 'movement_points_current'].some(field => Number(actor?.[field]) > 0))
        reason = 'Нет ресурсов для резерва реакции.';
    if (!reason && ['reaction', 'help'].includes(item.key) && reactionInProgress)
        reason = 'Нельзя резервировать действие во время другой реакции.';
    return { cost, tooltipCost, reason, detail: `${detail}${reason ? `\nНедоступно: ${reason}` : ''}`.trim(), allowed: allowed && !reason };
}
