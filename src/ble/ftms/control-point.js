
export const control = {
    requestControl: {
        encode: () => {
            const buffer = new ArrayBuffer(1);
            new DataView(buffer).setUint8(0, 0x00); // 0x00 = Request Control
            return buffer;
        },
        response: {
            decode: (dv) => {
                const op = dv.getUint8(0);
                const req = dv.getUint8(1);
                const res = dv.getUint8(2);
                return { op, req, res };
            }
        }
    },
    powerTarget: {
        encode: (args) => {
            const buffer = new ArrayBuffer(3);
            const view = new DataView(buffer);
            view.setUint8(0, 0x05); // Set Target Power
            view.setInt16(1, args.power, true);
            return buffer;
        }
    }
};
