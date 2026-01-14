
export const heartRateMeasurement = {
    decode: (dataview) => {
        const flags = dataview.getUint8(0);
        const hr16 = (flags & 1) === 1;

        let heartRate = 0;
        let i = 1;
        if (hr16) {
            heartRate = dataview.getUint16(i, true);
        } else {
            heartRate = dataview.getUint8(i);
        }
        return { heartRate };
    }
};
