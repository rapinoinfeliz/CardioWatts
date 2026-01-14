
import { Characteristic } from './characteristic.js';

function dataviewToArray(dataview) {
    return Array.from(new Uint8Array(dataview.buffer));
}

export function Service(args = {}) {
    const _service = args.service;
    const spec = args.spec || {};
    const protocol = args.protocol || (async () => true);
    let characteristics = {};

    async function setup() {
        try {
            const charList = await _service.getCharacteristics();
            const charMap = charList.reduce((acc, c) => { acc[c.uuid] = c; return acc; }, {});

            for (const key in spec) {
                const conf = spec[key];
                const bleChar = charMap[conf.uuid];

                if (bleChar) {
                    characteristics[key] = Characteristic({ characteristic: bleChar });

                    if (conf.notify) {
                        const parser = conf.notify.parser || { decode: (dv) => dataviewToArray(dv) };
                        const cb = conf.notify.callback;

                        await characteristics[key].startNotifications((dataview) => {
                            const msg = parser.decode(dataview);
                            if (cb) cb(msg);
                        });
                    }
                }
            }

            await protocol();
            return true;
        } catch (e) {
            console.error("Service setup failed", e);
            return false;
        }
    }

    return {
        setup,
        characteristics
    };
}
