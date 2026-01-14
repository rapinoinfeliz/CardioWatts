
import { exists, wait } from '../utils.js';
import { webBle } from './web-ble.js';

export function Characteristic(args = {}) {
    const _characteristic = args.characteristic;
    const uuid = _characteristic.uuid;
    const name = args.name ?? webBle.uuidToName(uuid);

    const writerFn = _characteristic.writeValueWithResponse ? 'writeValueWithResponse' : 'writeValue';

    async function startNotifications(handler) {
        try {
            await _characteristic.startNotifications();
            _characteristic.addEventListener('characteristicvaluechanged', (e) => {
                handler(e.target.value);
            });
            console.log(`BLE: Notifications started on ${name}`);
            return true;
        } catch (e) {
            console.error(`BLE: Failed to start notifications on ${name}`, e);
            return false;
        }
    }

    async function write(value) {
        try {
            await _characteristic[writerFn](value);
            return true;
        } catch (e) {
            console.warn(`BLE: Failed write on ${name}`, e);
            return false;
        }
    }

    async function writeWithRetry(value, attempts = 5, delayMs = 500) {
        for (let i = 0; i < attempts; i++) {
            if (await write(value)) return true;
            await wait(delayMs);
        }
        return false;
    }

    return {
        startNotifications,
        write,
        writeWithRetry,
        uuid
    };
}
