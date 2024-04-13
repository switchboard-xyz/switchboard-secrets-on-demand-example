import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  SB_ON_DEMAND_PID,
  Randomness,
  InstructionUtils,
  PullFeed,
  Queue
} from "@switchboard-xyz/on-demand";
import { getKeypairFromEnvironment } from "@solana-developers/helpers";
import { AnchorWallet,} from "@switchboard-xyz/solana.js";
import dotenv from "dotenv";
import resolve from "resolve-dir";
import { exec } from "child_process";
import * as fs from "fs";
import * as shell from "shelljs";
import reader from "readline-sync";
import { SwitchboardSecrets, OracleJob } from "@switchboard-xyz/common"; 
import { createHash } from "crypto";
import nacl from "tweetnacl";


function loadDefaultKeypair() {
  const command =
    'solana config get | grep "Keypair Path" | awk -F " " \'{ print $3 }\'';
  const res = shell.exec(command, { async: false }).stdout.trim();
  const payerJson = new Uint8Array(
    JSON.parse(fs.readFileSync(resolve(res), "utf8"))
  );
  return Keypair.fromSecretKey(payerJson);
}

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buildOpenWeatherAPI(city: String, secretName: String): OracleJob {
    const tasks = [
      OracleJob.Task.create({
        httpTask: OracleJob.HttpTask.create({
          url: `https://api.openweathermap.org/data/2.5/weather?q=${city},us&appid=${secretName}&units=metric`,
        }),
      }),
      OracleJob.Task.create({
        jsonParseTask: OracleJob.JsonParseTask.create({ path: "$.main.temp" }),
      }),
    ];
    return OracleJob.create({ tasks });
  }

  (async function () {
    dotenv.config();
    console.clear();
    const API_KEY = process.env.OPEN_WEATHER_API_KEY;

    const keypair = loadDefaultKeypair();
    const COMMITMENT = "confirmed";
  
    const sbProgramId = SB_ON_DEMAND_PID;
    const url = "https://api.devnet.solana.com";
    let connection = new Connection(url, {
      commitment: COMMITMENT,
    });
    // const connection = new Connection(
    //     "https://switchbo-switchbo-6225.devnet.rpcpool.com/f6fb9f02-0777-498b-b8f5-67cbb1fc0d14",
    //     "confirmed"
    //   );
    const wallet = new AnchorWallet(keypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: COMMITMENT,
      preflightCommitment: COMMITMENT,
    });
    // Switchboard sbQueue fixed
    const sbQueue = new PublicKey("5Qv744yu7DmEbU669GmYRqL9kpQsyYsaVKdR8YiBMTaP");
    const sbIdl = await anchor.Program.fetchIdl(sbProgramId, provider);
    const sbProgram = new anchor.Program(sbIdl!, sbProgramId, provider);


    const sbSecrets = new SwitchboardSecrets();
    console.log("\n🔒 Step 1: Creating the User for Secrets")
    try {
        const user = await sbSecrets.getUser(wallet.publicKey.toBase58(),"ed25519");
        console.log("User found",user);
    } catch (error) {
        console.log("User not found, creating user");
        const payload = await sbSecrets.createOrUpdateUserRequest(wallet.publicKey.toBase58(),"ed25519","");
        const signature = nacl.sign.detached(
            new Uint8Array(payload.toEncodedMessage()),
            wallet.payer.secretKey
          );
        const user = await sbSecrets.createOrUpdateUser(
            payload,
            Buffer.from(signature).toString("base64")
          );
        console.log("User created",user);
    }

    const secretName = "OPEN_WEATHER_API_KEY";
    const secretValue = API_KEY ?? "API_KEY_NOT_FOUND";
    console.log("\n🔒 Step 2: Checking and Creating the Secret");

    const userSecrets = await sbSecrets.getUserSecrets(wallet.publicKey.toBase58(), "ed25519");
    console.log("User Secrets",userSecrets)
    const existingSecret = userSecrets.find(secret => secret.secret_name === secretName);
    
    if (existingSecret) {
        console.log(`Secret '${secretName}' already exists. No need to create.`);
      } else {
        console.log(`Secret '${secretName}' not found. Creating now...`);
        const secretRequest = sbSecrets.createSecretRequest(
            wallet.publicKey.toBase58(),
            "ed25519", 
            secretName, 
            secretValue
        );
        const secretSignature = nacl.sign.detached(
            new Uint8Array(secretRequest.toEncodedMessage()),
            wallet.payer.secretKey
        );
        const secret = await sbSecrets.createSecret(
            secretRequest,
            Buffer.from(secretSignature).toString("base64")
        );
        console.log("Secret created:", secret);
      }
    
    // //const whitelist = await sbSecrets.createAddMrEnclaveRequest
    // // create feed that references the Secret API KEY
    // console.log("\n🔒 Step 3: Creating the Feed keypair");
    // // create a new keypair and save it in your .env file if you havent already.. 
    // //const feedKp = Keypair.generate();

    const feedSecretKey = process.env.FEED_SECRET_KEY || "";
    const feeddkeypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(feedSecretKey)));
    console.log("feeddkeypair",feeddkeypair.publicKey.toBase58());
    const jobdefinition = buildOpenWeatherAPI("Aspen", 'OPEN_WEATHER_API_KEY');

    const sha256job = createHash("sha256").update(jobdefinition.toString()).digest("hex")
    
    const addwhitelist = await sbSecrets.createAddMrEnclaveRequest(wallet.publicKey.toBase58(), "ed25519", sha256job , [secretName]);
    console.log("addwhitelist",addwhitelist);

    const whitelistSignature = nacl.sign.detached(
        new Uint8Array(addwhitelist.toEncodedMessage()),
        wallet.payer.secretKey
    );
    
    const sendwhitelist = await sbSecrets.addMrEnclave(
        addwhitelist, 
        Buffer.from(whitelistSignature).toString("base64"));

    console.log("sendwhitelist",sendwhitelist);

    const getuserSecrets = await sbSecrets.getUserSecrets(wallet.publicKey.toBase58(), "ed25519");
    console.log("getuserSecrets",getuserSecrets);
    const pullFeed = new PullFeed(sbProgram , feeddkeypair.publicKey);
    
    const ixs = await PullFeed.solanaFetchUpsertIxs(sbProgram , {
        gateway: "https://sb-tester.org",
        feed: feeddkeypair.publicKey,
        queue: sbQueue,
        jobs: [buildOpenWeatherAPI("Aspen", 'OPEN_WEATHER_API_KEY')],
        numSignatures: 1,
        maxVariance: 1,
        minResponses: 1,
      });
      const tx = await InstructionUtils.asV0Tx(sbProgram, ixs);
      tx.sign([wallet.payer, feeddkeypair]);
      const transaction = await sbProgram.provider.connection.sendTransaction(tx, {
        // preflightCommitment is REQUIRED to be processed or disabled
        preflightCommitment: "processed",
      });
      console.log("transaction", transaction);

  })();
  