
import { webBle, uuids } from './web-ble.js';
import FTMS from './ftms/ftms.js';
import HRS from './hrs/hrs.js';

export default function Connectable(args = {}) {
    const onData = args.onData || (d => console.log('data', d));
    const onStatus = args.onStatus || (s => console.log('status', s));

    // State
    let connectedDevices = {
        trainer: null,
        hr: null
    };
    let services = {};

    async function scanFor(name, filters) {
        try {
            onStatus(`Scanning for ${name}...`);
            const device = await navigator.bluetooth.requestDevice(filters);
            await connectToDevice(device, name);
            return true;
        } catch (e) {
            console.warn(`Cancelled or failed to connect to ${name}`, e);
            onStatus(`Failed to connect ${name}`);
            return false;
        }
    }

    async function connectToDevice(device, name) {
        device.addEventListener('gattserverdisconnected', onDisconnected);
        const server = await device.gatt.connect();
        console.log(`Connected to ${device.name}`);
        onStatus(`${name} Connected`);

        // Service Discovery
        const primServices = await server.getPrimaryServices();
        for (const s of primServices) {
            if (s.uuid === uuids.fitnessMachine) {
                console.log("Found FTMS Service");
                services.trainer = FTMS({ service: s, onData });
                await services.trainer.setup();
                connectedDevices.trainer = device; // Store ref
            }
            if (s.uuid === uuids.cyclingPower) {
                console.log("Found Power Service");
            }
            if (s.uuid === uuids.heartRate) {
                console.log("Found Heart Rate Service");
                services.hr = HRS({ service: s, onData });
                await services.hr.setup();
                connectedDevices.hr = device; // Store ref
            }
        }
    }

    async function onDisconnected(event) {
        const device = event.target;
        console.log(`Check: ${device.name} disconnected`);
        onStatus(`${device.name} Disconnected!`);

        // Auto-Reconnect Loop
        reconnect(device);
    }

    async function reconnect(device) {
        let attempts = 0;
        while (!device.gatt.connected && attempts < 10) {
            try {
                attempts++;
                onStatus(`Reconnecting ${device.name} (${attempts}/10)...`);
                console.log(`Reconnecting attempt ${attempts}...`);
                await device.gatt.connect();
                onStatus(`${device.name} Reconnected`);
                console.log("Reconnected!");
                return; // Success
            } catch (error) {
                console.log("Reconnect failed, retrying in 2s...");
                await new Promise(r => setTimeout(r, 2000));
            }
        }
        onStatus(`Lost connection to ${device.name}`);
    }

    async function connectTrainer() {
        return await scanFor("Trainer", {
            filters: [{ services: [uuids.fitnessMachine] }],
            optionalServices: [uuids.cyclingPower, uuids.speedCadence]
        });
    }

    async function connectHR() {
        return await scanFor("Heart Rate", {
            filters: [{ services: [uuids.heartRate] }]
        });
    }

    async function setPower(watts) {
        try {
            if (services.trainer) {
                await services.trainer.setPower(watts);
            }
        } catch (e) {
            console.warn("Failed to set power (disconnected?)");
        }
    }

    async function disconnect(type) {
        const device = connectedDevices[type];
        if (device && device.gatt.connected) {
            console.log(`Disconnecting ${type}...`);
            // Remove listener so auto-reconnect doesn't fire
            device.removeEventListener('gattserverdisconnected', onDisconnected);
            try {
                await device.gatt.disconnect();
            } catch (e) {
                console.warn("Disconnect error", e);
            }
            onStatus(`${type} Disconnected (User)`);
        }
        connectedDevices[type] = null;
        services[type] = null;
    }

    return {
        connectTrainer,
        connectHR,
        disconnect, // Export
        setPower,
        services
    };
}
