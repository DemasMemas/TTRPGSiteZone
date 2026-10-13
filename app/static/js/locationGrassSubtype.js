export function grassSubtype(tile) {
    return tile?.terrain === 'grass' && tile.grass_subtype === 'forest' ? 'forest' : 'plain';
}
