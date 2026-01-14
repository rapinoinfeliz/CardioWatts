
import { Service } from '../service.js';
import { uuids } from '../web-ble.js';
import { indoorBikeData } from './indoor-bike-data.js';
import { control } from './control-point.js';

export default function FTMS(args = {}) {
    const onData = args.onData;

    // Protocol: Request Control upon connection
    async function protocol() {
        const chars = service.characteristics;
        if (chars.control) {
            console.log("FTMS: Requesting Control...");
            await chars.control.write(control.requestControl.encode());
        }
    }

    const spec = {
        measurement: {
            uuid: uuids.indoorBikeData,
            notify: { callback: onData, parser: indoorBikeData }
        },
        control: {
            uuid: uuids.fitnessMachineControlPoint,
            notify: { callback: (msg) => console.log("FTMS Control Resp:", msg), parser: control.requestControl.response }
        }
    };

    const service = Service({
        service: args.service,
        spec,
        protocol
    });

    async function setPower(watts) {
        if (service.characteristics.control) {
            return await service.characteristics.control.writeWithRetry(
                control.powerTarget.encode({ power: watts })
            );
        }
        return false;
    }

    return Object.freeze({
        ...service,
        setPower
    });
}
