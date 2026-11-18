(function (root, factory) {
    const biomes = factory();
    if (typeof module === 'object' && module.exports) module.exports = biomes;
    else root.PixameBiomes = biomes;
})(globalThis, function () {
    const chunkSize = 32;
    const regionSize = chunkSize * 4;
    const definitions = [
        {name: 'snow', temperature: 0.10, moisture: 0.48, tree: null, density: 0},
        {name: 'tundra', temperature: 0.19, moisture: 0.30, tree: null, density: 0},
        {name: 'taiga', temperature: 0.29, moisture: 0.55, tree: 'spruce', density: 0.04},
        {name: 'cherry_grove', temperature: 0.42, moisture: 0.67, tree: 'cherry', density: 0.035},
        {name: 'forest', temperature: 0.49, moisture: 0.68, tree: 'oak', density: 0.06},
        {name: 'meadow', temperature: 0.55, moisture: 0.62, tree: 'birch', density: 0.008},
        {name: 'plains', temperature: 0.61, moisture: 0.48, tree: 'oak', density: 0.018},
        {name: 'savanna', temperature: 0.72, moisture: 0.30, tree: 'acacia', density: 0.012},
        {name: 'rainforest', temperature: 0.82, moisture: 0.90, tree: 'jungle', density: 0.065},
        {name: 'desert', temperature: 0.94, moisture: 0.12, tree: null, density: 0}
    ];

    function sampleRegion(x, z, seed) {
        const rx = Math.floor(x / regionSize);
        const rz = Math.floor(z / regionSize);
        let hash = Math.imul(rx, 0x1f123bb5) ^ Math.imul(rz, 0x5f356495) ^ seed;
        hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
        hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
        hash = (hash ^ (hash >>> 16)) >>> 0;
        return definitions[hash % definitions.length];
    }

    function sampleClimate(x, z, seed) {
        const region = sampleRegion(x, z, seed);
        const localX = x - Math.floor(x / regionSize) * regionSize;
        const localZ = z - Math.floor(z / regionSize) * regionSize;
        const blendDistance = 16;
        const dx = localX < blendDistance ? -regionSize : localX >= regionSize - blendDistance ? regionSize : 0;
        const dz = localZ < blendDistance ? -regionSize : localZ >= regionSize - blendDistance ? regionSize : 0;
        const wx = dx < 0 ? (blendDistance - localX) / (2 * blendDistance)
            : dx > 0 ? (localX - regionSize + blendDistance) / (2 * blendDistance) : 0;
        const wz = dz < 0 ? (blendDistance - localZ) / (2 * blendDistance)
            : dz > 0 ? (localZ - regionSize + blendDistance) / (2 * blendDistance) : 0;
        let temperature = region.temperature * (1 - wx) * (1 - wz);
        let moisture = region.moisture * (1 - wx) * (1 - wz);
        if (dx) {
            const neighbour = sampleRegion(x + dx, z, seed);
            temperature += neighbour.temperature * wx * (1 - wz);
            moisture += neighbour.moisture * wx * (1 - wz);
        }
        if (dz) {
            const neighbour = sampleRegion(x, z + dz, seed);
            temperature += neighbour.temperature * (1 - wx) * wz;
            moisture += neighbour.moisture * (1 - wx) * wz;
        }
        if (dx && dz) {
            const neighbour = sampleRegion(x + dx, z + dz, seed);
            temperature += neighbour.temperature * wx * wz;
            moisture += neighbour.moisture * wx * wz;
        }
        return {region, temperature, moisture};
    }

    return {chunkSize, regionSize, sampleRegion, sampleClimate};
});
