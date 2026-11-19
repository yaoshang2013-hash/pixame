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
        {name: 'desert', temperature: 0.94, moisture: 0.12, tree: null, density: 0},
        {name: 'birch_forest', temperature: 0.53, moisture: 0.66, tree: 'birch', density: 0.045},
        {name: 'dark_forest', temperature: 0.46, moisture: 0.78, tree: 'dark_oak', density: 0.055},
        {name: 'mixed_forest', temperature: 0.50, moisture: 0.70, tree: 'oak', secondTree: 'birch', density: 0.05},
        {name: 'cold_taiga', temperature: 0.24, moisture: 0.58, tree: 'spruce', density: 0.045},
        {name: 'alpine_meadow', temperature: 0.35, moisture: 0.54, tree: 'birch', density: 0.006},
        {name: 'dry_scrub', temperature: 0.76, moisture: 0.22, tree: 'acacia', density: 0.006},
        {name: 'frozen_forest', temperature: 0.14, moisture: 0.60, tree: 'spruce', density: 0.035}
    ];

    function regionAt(rx, rz, seed) {
        let hash = Math.imul(rx, 0x1f123bb5) ^ Math.imul(rz, 0x5f356495) ^ seed;
        hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
        hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
        hash = (hash ^ (hash >>> 16)) >>> 0;
        return definitions[hash % definitions.length];
    }

    function warpedPosition(x, z, seed) {
        const phase = (seed >>> 0) * 0.00001;
        return {
            x: x + 24 * Math.sin(z * 0.013 + phase) + 10 * Math.sin((x + z) * 0.021 - phase),
            z: z + 24 * Math.sin(x * 0.012 - phase) + 10 * Math.sin((x - z) * 0.019 + phase)
        };
    }

    function sampleRegion(x, z, seed) {
        const warped = warpedPosition(x, z, seed);
        return regionAt(Math.floor(warped.x / regionSize), Math.floor(warped.z / regionSize), seed);
    }

    function sampleClimate(x, z, seed) {
        const warped = warpedPosition(x, z, seed);
        const rx = Math.floor(warped.x / regionSize);
        const rz = Math.floor(warped.z / regionSize);
        const region = regionAt(rx, rz, seed);
        const localX = warped.x - rx * regionSize;
        const localZ = warped.z - rz * regionSize;
        const blendDistance = 28;
        const dx = localX < blendDistance ? -1 : localX >= regionSize - blendDistance ? 1 : 0;
        const dz = localZ < blendDistance ? -1 : localZ >= regionSize - blendDistance ? 1 : 0;
        const wx = dx < 0 ? (blendDistance - localX) / (2 * blendDistance)
            : dx > 0 ? (localX - regionSize + blendDistance) / (2 * blendDistance) : 0;
        const wz = dz < 0 ? (blendDistance - localZ) / (2 * blendDistance)
            : dz > 0 ? (localZ - regionSize + blendDistance) / (2 * blendDistance) : 0;
        const neighbours = [];
        let temperature = region.temperature * (1 - wx) * (1 - wz);
        let moisture = region.moisture * (1 - wx) * (1 - wz);
        if (dx) {
            const neighbour = regionAt(rx + dx, rz, seed);
            neighbours.push({region: neighbour, weight: wx * (1 - wz)});
            temperature += neighbour.temperature * wx * (1 - wz);
            moisture += neighbour.moisture * wx * (1 - wz);
        }
        if (dz) {
            const neighbour = regionAt(rx, rz + dz, seed);
            neighbours.push({region: neighbour, weight: (1 - wx) * wz});
            temperature += neighbour.temperature * (1 - wx) * wz;
            moisture += neighbour.moisture * (1 - wx) * wz;
        }
        if (dx && dz) {
            const neighbour = regionAt(rx + dx, rz + dz, seed);
            neighbours.push({region: neighbour, weight: wx * wz});
            temperature += neighbour.temperature * wx * wz;
            moisture += neighbour.moisture * wx * wz;
        }
        const transitions = neighbours.filter(entry => entry.region !== region && entry.weight > 0.15);
        return {region, temperature, moisture, transitions};
    }

    return {chunkSize, regionSize, sampleRegion, sampleClimate};
});
