"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const anchor = __importStar(require("@coral-xyz/anchor"));
const web3_js_1 = require("@solana/web3.js");
const on_demand_1 = require("@switchboard-xyz/on-demand");
const solana_js_1 = require("@switchboard-xyz/solana.js");
const dotenv_1 = __importDefault(require("dotenv"));
const resolve_dir_1 = __importDefault(require("resolve-dir"));
const fs = __importStar(require("fs"));
const shell = __importStar(require("shelljs"));
const common_1 = require("@switchboard-xyz/common");
const crypto_1 = require("crypto");
const tweetnacl_1 = __importDefault(require("tweetnacl"));
function loadDefaultKeypair() {
    const command = 'solana config get | grep "Keypair Path" | awk -F " " \'{ print $3 }\'';
    const res = shell.exec(command, { async: false }).stdout.trim();
    const payerJson = new Uint8Array(JSON.parse(fs.readFileSync((0, resolve_dir_1.default)(res), "utf8")));
    return web3_js_1.Keypair.fromSecretKey(payerJson);
}
function sleep(ms) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve) => setTimeout(resolve, ms));
    });
}
function buildOpenWeatherAPI(city, secretName) {
    const tasks = [
        common_1.OracleJob.Task.create({
            httpTask: common_1.OracleJob.HttpTask.create({
                url: `https://api.openweathermap.org/data/2.5/weather?q=${city},us&appid=${secretName}&units=metric`,
            }),
        }),
        common_1.OracleJob.Task.create({
            jsonParseTask: common_1.OracleJob.JsonParseTask.create({ path: "$.main.temp" }),
        }),
    ];
    return common_1.OracleJob.create({ tasks });
}
(function () {
    return __awaiter(this, void 0, void 0, function* () {
        dotenv_1.default.config();
        console.clear();
        const API_KEY = process.env.OPEN_WEATHER_API_KEY;
        const keypair = loadDefaultKeypair();
        const COMMITMENT = "confirmed";
        const sbProgramId = on_demand_1.SB_ON_DEMAND_PID;
        const url = "https://api.devnet.solana.com";
        let connection = new web3_js_1.Connection(url, {
            commitment: COMMITMENT,
        });
        // const connection = new Connection(
        //     "https://switchbo-switchbo-6225.devnet.rpcpool.com/f6fb9f02-0777-498b-b8f5-67cbb1fc0d14",
        //     "confirmed"
        //   );
        const wallet = new solana_js_1.AnchorWallet(keypair);
        const provider = new anchor.AnchorProvider(connection, wallet, {
            commitment: COMMITMENT,
            preflightCommitment: COMMITMENT,
        });
        // Switchboard sbQueue fixed
        const sbQueue = new web3_js_1.PublicKey("5Qv744yu7DmEbU669GmYRqL9kpQsyYsaVKdR8YiBMTaP");
        const sbIdl = yield anchor.Program.fetchIdl(sbProgramId, provider);
        const sbProgram = new anchor.Program(sbIdl, sbProgramId, provider);
        const sbSecrets = new common_1.SwitchboardSecrets();
        console.log("\n🔒 Step 1: Creating the User for Secrets");
        try {
            const user = yield sbSecrets.getUser(wallet.publicKey.toBase58(), "ed25519");
            console.log("User found", user);
        }
        catch (error) {
            console.log("User not found, creating user");
            const payload = yield sbSecrets.createOrUpdateUserRequest(wallet.publicKey.toBase58(), "ed25519", "");
            const signature = tweetnacl_1.default.sign.detached(new Uint8Array(payload.toEncodedMessage()), wallet.payer.secretKey);
            const user = yield sbSecrets.createOrUpdateUser(payload, Buffer.from(signature).toString("base64"));
            console.log("User created", user);
        }
        const secretName = "OPEN_WEATHER_API_KEY";
        const secretValue = API_KEY !== null && API_KEY !== void 0 ? API_KEY : "API_KEY_NOT_FOUND";
        console.log("\n🔒 Step 2: Checking and Creating the Secret");
        const userSecrets = yield sbSecrets.getUserSecrets(wallet.publicKey.toBase58(), "ed25519");
        console.log("User Secrets", userSecrets);
        const existingSecret = userSecrets.find(secret => secret.secret_name === secretName);
        if (existingSecret) {
            console.log(`Secret '${secretName}' already exists. No need to create.`);
        }
        else {
            console.log(`Secret '${secretName}' not found. Creating now...`);
            const secretRequest = sbSecrets.createSecretRequest(wallet.publicKey.toBase58(), "ed25519", secretName, secretValue);
            const secretSignature = tweetnacl_1.default.sign.detached(new Uint8Array(secretRequest.toEncodedMessage()), wallet.payer.secretKey);
            const secret = yield sbSecrets.createSecret(secretRequest, Buffer.from(secretSignature).toString("base64"));
            console.log("Secret created:", secret);
        }
        // //const whitelist = await sbSecrets.createAddMrEnclaveRequest
        // // create feed that references the Secret API KEY
        // console.log("\n🔒 Step 3: Creating the Feed keypair");
        // // create a new keypair and save it in your .env file if you havent already.. 
        // //const feedKp = Keypair.generate();
        const feedSecretKey = process.env.FEED_SECRET_KEY || "";
        const feeddkeypair = web3_js_1.Keypair.fromSecretKey(new Uint8Array(JSON.parse(feedSecretKey)));
        console.log("feeddkeypair", feeddkeypair.publicKey.toBase58());
        const jobdefinition = buildOpenWeatherAPI("Aspen", 'OPEN_WEATHER_API_KEY');
        //const sha256job = createHash("sha256").update(JSON.stringify(jobdefinition)).digest("hex");
        const sha256job = (0, crypto_1.createHash)("sha256").update(jobdefinition.toString()).digest("hex");
        const addwhitelist = yield sbSecrets.createAddMrEnclaveRequest(wallet.publicKey.toBase58(), "ed25519", sha256job, [secretName]);
        console.log("addwhitelist", addwhitelist);
        const whitelistSignature = tweetnacl_1.default.sign.detached(new Uint8Array(addwhitelist.toEncodedMessage()), wallet.payer.secretKey);
        const sendwhitelist = yield sbSecrets.addMrEnclave(addwhitelist, Buffer.from(whitelistSignature).toString("base64"));
        console.log("sendwhitelist", sendwhitelist);
        const getuserSecrets = yield sbSecrets.getUserSecrets(wallet.publicKey.toBase58(), "ed25519");
        console.log("getuserSecrets", getuserSecrets);
        const pullFeed = new on_demand_1.PullFeed(sbProgram, feeddkeypair.publicKey);
        //const now = Math.floor(+Date.now() / 1000);
        const ixs = yield on_demand_1.PullFeed.solanaFetchUpsertIxs(sbProgram, {
            gateway: "https://sb-tester.org",
            feed: feeddkeypair.publicKey,
            queue: sbQueue,
            jobs: [buildOpenWeatherAPI("Aspen", 'OPEN_WEATHER_API_KEY')],
            numSignatures: 1,
            maxVariance: 1,
            minResponses: 1,
        });
        const tx = yield on_demand_1.InstructionUtils.asV0Tx(sbProgram, ixs);
        tx.sign([wallet.payer, feeddkeypair]);
        const transaction = yield sbProgram.provider.connection.sendTransaction(tx, {
            // preflightCommitment is REQUIRED to be processed or disabled
            preflightCommitment: "processed",
        });
        console.log("transaction", transaction);
    });
})();
