"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const http_1 = require("http");
const full_1 = require("../full");
const io_1 = require("../util/io");
const logging_1 = require("../util/logging");
const util_1 = require("../util/util");
const rolling_logs_1 = require("./rolling-logs");
const settings_1 = require("./settings");
const timers_1 = require("timers");
async function webhookServer(key, githubAccessToken, dry, fetcher, options) {
    const fullOne = updateOneAtATime(async (log, timeStamp) => {
        log.info("");
        log.info("");
        log.info(`# ${timeStamp}`);
        log.info("");
        log.info("Starting full...");
        await full_1.default(dry, timeStamp, githubAccessToken, fetcher, options);
    });
    timers_1.setInterval(fullOne, 300000, logging_1.loggerWithErrors()[0], util_1.currentTimeStamp());
    return listenToGithub(key, fullOne);
}
exports.default = webhookServer;
function writeLog(rollingLogs, logs) {
    return rollingLogs.write(logging_1.joinLogWithErrors(logs));
}
/** @param onUpdate: returns a promise in case it may error. Server will shut down on errors. */
function listenToGithub(key, onUpdate) {
    console.log("Before starting server");
    const rollingLogs = rolling_logs_1.default.create("webhook-logs.md", 1000);
    const server = http_1.createServer((req, resp) => {
        switch (req.method) {
            case "POST":
                receiveUpdate(req, resp);
                break;
            default:
            // Don't respond
        }
    });
    return server;
    function receiveUpdate(req, resp) {
        const [log, logResult] = logging_1.loggerWithErrors();
        const timeStamp = util_1.currentTimeStamp();
        try {
            log.info("Before starting work");
            work().then(() => rollingLogs.then(logs => writeLog(logs, logResult()))).catch(onError);
        }
        catch (error) {
            rollingLogs
                .then(logs => writeLog(logs, logResult()))
                .then(onError)
                .catch(onError);
        }
        function onError() {
            server.close();
        }
        async function work() {
            const data = await io_1.stringOfStream(req, "Request to webhook");
            if (!checkSignature(key, data, req.headers, log)) {
                return;
            }
            log.info(`Message from github: ${data.slice(0, 200)}...`);
            const expectedRef = `refs/heads/${settings_1.sourceBranch}`;
            const actualRef = util_1.parseJson(data).ref;
            if (actualRef === expectedRef) {
                respond("Thanks for the update! Running full.");
                await onUpdate(log, timeStamp);
            }
            else {
                const text = `Ignoring push to ${actualRef}, expected ${expectedRef}.`;
                respond(text);
                log.info(text);
            }
        }
        // This is for the benefit of `npm run make-[production-]server-run`. GitHub ignores this.
        function respond(text) {
            resp.write(text);
            resp.end();
        }
    }
}
// Even if there are many changes to DefinitelyTyped in a row, we only perform one update at a time.
function updateOneAtATime(doOnce) {
    let working = false;
    let anyUpdatesWhileWorking = false;
    return (log, timeStamp) => {
        if (working) {
            anyUpdatesWhileWorking = true;
            log.info("Not starting update, because already performing one.");
            return undefined;
        }
        else {
            working = false;
            anyUpdatesWhileWorking = false;
            return work();
        }
        async function work() {
            log.info("Starting update");
            working = true;
            anyUpdatesWhileWorking = false;
            do {
                await doOnce(log, timeStamp);
                working = false;
            } while (anyUpdatesWhileWorking);
        }
    };
}
function checkSignature(key, data, headers, log) {
    const signature = headers["x-hub-signature"];
    const expected = expectedSignature(key, data);
    // tslint:disable-next-line strict-type-predicates (TODO: tslint bug)
    if (typeof signature === "string" && stringEqualsConstantTime(signature, expected)) {
        return true;
    }
    log.error(`Invalid request: expected ${expected}, got ${signature}`);
    log.error(`Headers are: ${JSON.stringify(headers, undefined, 4)}`);
    log.error(`Data is: ${data}`);
    log.error("");
    return false;
}
// Use a constant-time compare to prevent timing attacks
function stringEqualsConstantTime(actual, expected) {
    // `timingSafeEqual` throws if they don't have the same length.
    const actualBuffer = Buffer.alloc(expected.length);
    actualBuffer.write(actual);
    return crypto_1.timingSafeEqual(actualBuffer, Buffer.from(expected));
}
function expectedSignature(key, data) {
    const hmac = crypto_1.createHmac("sha1", key);
    hmac.write(data);
    const digest = hmac.digest("hex");
    return `sha1=${digest}`;
}
exports.expectedSignature = expectedSignature;
//# sourceMappingURL=webhook-server.js.map