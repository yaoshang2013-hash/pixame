(function (root, factory) {
    const caves = factory();
    if (typeof module === 'object' && module.exports) module.exports = caves;
    else root.PixameCaves = caves;
})(globalThis, function () {
    function hash(x, z, seed) {
        let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ seed;
        value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
        value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
        return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
    }

    function noise(x, z, seed) {
        const ix = Math.floor(x), iz = Math.floor(z);
        const fx = x - ix, fz = z - iz;
        const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
        const a = hash(ix, iz, seed) * (1 - u) + hash(ix + 1, iz, seed) * u;
        const b = hash(ix, iz + 1, seed) * (1 - u) + hash(ix + 1, iz + 1, seed) * u;
        return a * (1 - v) + b * v;
    }

    function caveShape(x, z, seed) {
        const field = noise(x / 38, z / 38, seed + 400) * 0.7 +
            noise(x / 14, z / 14, seed + 401) * 0.3;
        if (field <= 0.52) return null;
        const radius = 2 + Math.floor(Math.min(1, (field - 0.52) / 0.3) * 3);
        const center = -17 + Math.round((noise(x / 55, z / 55, seed + 402) - 0.5) * 8);
        const floor = Math.max(-30, center - radius);
        const ceiling = Math.min(-5, center + radius);
        return { floor, ceiling };
    }

    function sample(x, z, seed, climate) {
        const shape = caveShape(x, z, seed);
        if (!shape) return null;
        const gridX = Math.floor(x / 24), gridZ = Math.floor(z / 24);
        const anchorX = gridX * 24 + 3 + Math.floor(hash(gridX, gridZ, seed + 404) * 17);
        const anchorZ = gridZ * 24 + 3 + Math.floor(hash(gridX, gridZ, seed + 405) * 17);
        const offsets = hash(gridX, gridZ, seed + 406) < 0.5
            ? [[0, 0], [1, 0], [0, 1]]
            : [[0, 0], [1, 0], [0, 1], [1, 1]];
        let water = false;
        if (hash(gridX, gridZ, seed + 407) < 0.6 && offsets.some(([dx, dz]) => x === anchorX + dx && z === anchorZ + dz)) {
            water = offsets.every(([dx, dz]) => {
                const neighbor = caveShape(anchorX + dx, anchorZ + dz, seed);
                return neighbor && neighbor.floor === shape.floor && neighbor.floor > -30;
            });
        }
        const biome = climate.temperature <= 0.25 || climate.region.temperature <= 0.25 ? 'ice'
            : noise(x / 100, z / 100, seed + 403) > 0.5 ? 'fungal' : 'moss';
        return { floor: shape.floor - (water ? 1 : 0), ceiling: shape.ceiling, biome, water };
    }

    function contains(profile, y) {
        return !!profile && y >= profile.floor && y <= profile.ceiling;
    }

    return {sample, contains};
});
