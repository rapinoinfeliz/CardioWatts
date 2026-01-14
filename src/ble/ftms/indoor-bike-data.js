
const fields = {
    flags: { size: 2 },
    speed: { size: 2, resolution: 0.01, present: (f) => !((f & 1) === 1) }, // Note: Flag 0=More Data? No, bit 0 is Instantaneous Speed present? Actually spec says 0=More Data usually, but here: Bit 0: 0=More Data(No), 1=Speed Present? 
    // Let's copy standard logic: 
    // Bit 0: 0=More Data False? 
    // Actually looking at original file: speedPresent = (flags >> 0) & 1 === 0. So 0 means present.
    // Instantaneous Speed: Resolution 0.01

    // Simplification: I'll trust the original logic order.
    // field size resolution presentCheck
};

export const indoorBikeData = {
    decode: (dataview) => {
        let i = 0;
        const flags = dataview.getUint16(i, true);
        i += 2;

        const data = {};

        // Speed (Bit 0 == 0)
        if ((flags & 1) === 0) {
            data.speed = dataview.getUint16(i, true) * 0.01;
            i += 2;
        }

        // Avg Speed (Bit 1)
        if ((flags >> 1) & 1) i += 2;

        // Cadence (Bit 2)
        if ((flags >> 2) & 1) {
            data.cadence = dataview.getUint16(i, true) * 0.5;
            i += 2;
        }

        // Avg Cadence (Bit 3)
        if ((flags >> 3) & 1) i += 2;

        // Distance (Bit 4) (Uint24)
        if ((flags >> 4) & 1) {
            const dist = dataview.getUint8(i) | (dataview.getUint8(i + 1) << 8) | (dataview.getUint8(i + 2) << 16);
            data.distance = dist;
            i += 3;
        }

        // Resistance (Bit 5)
        if ((flags >> 5) & 1) i += 2;

        // Power (Bit 6)
        if ((flags >> 6) & 1) {
            data.power = dataview.getInt16(i, true);
            i += 2;
        }

        // HEART RATE (Bit 9)
        // Skip Exp Energy (Bit 8)
        if ((flags >> 8) & 1) {
            // Energy Total (2) + Per Hour (2) + Per Min (1) = 5 bytes
            i += 5;
        }

        if ((flags >> 9) & 1) {
            data.heartRate = dataview.getUint8(i);
            i += 1;
        }

        return data;
    }
};
