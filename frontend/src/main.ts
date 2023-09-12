import { subscribe } from "exome";
import { ZeroHash, sha256, toBeArray, toBeHex, toBigInt } from "ethers";
import { WebAuthNExample__factory } from "demo-authzn-backend";
import { pbkdf2Sync } from "pbkdf2"

import * as sapphire from "@oasisprotocol/sapphire-paratime";
import { ethers } from "ethers";
import { Exome } from "exome"

import { NETWORKS, NetworkDefinition } from "./networks.ts";
import { credentialCreate, credentialGet } from "demo-authzn-backend/src/webauthn.ts";
import { Account__factory, TOTPExample__factory } from "demo-authzn-backend/typechain-types/index.ts";
import { resolvePackageData } from "vite";

// ------------------------------------------------------------------

export interface AppConfig {
  sapphireJsonRpc: string;
  webauthContract: string;
  sapphireChainId: number;
  totpContract: string;
}

// ------------------------------------------------------------------

export interface EthWallet {
  chainId: number;
  network?: NetworkDefinition;
}

// ------------------------------------------------------------------

export class EthProviders extends Exome
{
  public up?: ethers.JsonRpcProvider;

  // Sapphire Wrapped Provider
  public swp?: ethers.JsonRpcProvider & sapphire.SapphireAnnex;

  public wallet?: EthWallet;

  public connected: boolean;

  constructor (private _config: AppConfig)
  {
      super();

      this.connected = false;
  }

  async refresh ()
  {
      const nid = this._config.sapphireChainId;
      const n = nid in NETWORKS ? NETWORKS[nid] : undefined;
      this.wallet = {
          chainId: nid,
          network: n
      };

      this.up = new ethers.JsonRpcProvider(this._config.sapphireJsonRpc);

      this.swp = sapphire.wrap(this.up);

      this.connected = true;

      return true;
  }

  async attach ()
  {
      await this.refresh();
      return true;
  }
}

// ------------------------------------------------------------------

function setVisibility(x:HTMLElement, hidden:boolean|undefined) {
  x.style.visibility = hidden ? 'visible' : 'hidden';
}

function setDisabled(element:HTMLElement, disabled:boolean) {
  if( disabled ) {
    return element.setAttribute('disabled', 'disabled');
  }
  element.removeAttribute('disabled');
}

// ------------------------------------------------------------------

/**
 * Manages the username widgets
 * Checks if username is available
 * Shows spinner next to textbox
 * Shows error messages
 * Validates usernames etc.
 */
class UsernameManager
{
  usernameInput = document.querySelector<HTMLInputElement>('#webauthn-username')!;
  usernameCheck = document.querySelector<HTMLButtonElement>('#webauthn-username-check')!;
  usernameStatus = document.querySelector<HTMLSpanElement>('#webauthn-username-status')!;
  usernameSpinner = document.querySelector<HTMLImageElement>('#webauthn-username-spinner')!;

  private _usernameHashesCache: {[id:string]:Uint8Array} = {};
  private _salt: Uint8Array|null = null;

  constructor (private _providers:EthProviders, private _config: AppConfig) {
    subscribe(_providers, this._onProvidersUpdate.bind(this));
    this._onProvidersUpdate();
  }

  async salt () {
    if( this._salt === null ) { // Retirve contract salt only once
      this._salt = toBeArray(await this.readonlyContract.salt());
    }
    return this._salt;
  }

  async _onProvidersUpdate() {
    //const disabled = ! this._providers.connected;
    const disabled = false;
    setDisabled(this.usernameInput, disabled);
    setDisabled(this.usernameCheck, disabled);
  }

  get readonlyContract () {
    if( ! this._providers.swp ) {
      throw Error('Not connected!');
    }
    return WebAuthNExample__factory.connect(this._config.webauthContract, this._providers.swp);
  }

  async attach () {
    this.usernameCheck.addEventListener('click', this._onCheck.bind(this));
  }

  get username () {
    const x = this.usernameInput.value.toLowerCase();
    if( x.length ) {
      return x;
    }
  }

  async hashedUsername (username?: string) : Promise<Uint8Array> {
    if( ! username ) {
      username = this.username;
    }
    if( ! username ) {
      throw new Error('Cannot hash undefined username!');
    }
    if( username in this._usernameHashesCache ) { // Cache pbkdf2 hashed usernames locally
      return this._usernameHashesCache[username];
    }

    const start = new Date();
    const result = pbkdf2Sync(username, await this.salt(), 100_000, 32, 'sha256');
    const end = new Date();
    console.log('pbkdf2', username, '=', end.getTime() - start.getTime(), 'ms');
    this._usernameHashesCache[username] = result;
    return result;
  }

  async _userExists(username:string) {
    const h = await this.hashedUsername(username);
    if( h ) {
      return await this.readonlyContract.userExists(h);
    }
  }

  async _onCheck () {
    try {
      const available =  await this.checkUsername(false);
      if( available ) {
        this.usernameStatus.innerText = 'Available';
      }
    }
    catch(e:any) {
      this.usernameStatus.innerText = `Error: ${e}`;
    }
  }

  async checkUsername (mustExist:boolean) {
    this.usernameStatus.innerText = '...';
    setVisibility(this.usernameSpinner, true);
    try {
      const re = /^[a-zA-Z0-9_\.\-]+(@([a-zA-Z0-9\.\-]+))?$/;
      const username = this.username;
      if( ! username ) {
        this._finishCheckUsername('Required!');
        return false;
      }
      if( ! re.test(username) ) {
        return this._finishCheckUsername('Bad Chars!');
      }
      if( await this._userExists(username) ) {
        if( ! mustExist ) {
          return this._finishCheckUsername('Already Exists!');
        }
      }
      else if( mustExist ) {
        return this._finishCheckUsername("Doesn't Exist!");
      }
      return this._finishCheckUsername('', true);
    }
    finally {
      setVisibility(this.usernameSpinner, false);
    }
  }

  _finishCheckUsername(status:string, success?:boolean) {
    this.usernameStatus.innerText = status;
    if( ! success ) {
      this.usernameInput.focus();
    }
    return !!success;
  }
}

// ------------------------------------------------------------------

class WebAuthNManager
{
  registerButton = document.querySelector<HTMLButtonElement>('#webauthn-register-button')!;
  registerStatus = document.querySelector<HTMLSpanElement>('#webauthn-register-status')!;
  registerSpinner = document.querySelector<HTMLImageElement>('#webauthn-register-spinner')!;

  testButton = document.querySelector<HTMLButtonElement>('#webauthn-test-button')!;
  testStatus = document.querySelector<HTMLSpanElement>('#webauthn-test-status')!;
  testSpinner = document.querySelector<HTMLImageElement>('#webauthn-test-spinner')!;

  totpButton = document.querySelector<HTMLButtonElement>('#webauthn-totp-button')!;
  totpStatus = document.querySelector<HTMLSpanElement>('#webauthn-totp-status')!;
  totpSpinner = document.querySelector<HTMLImageElement>('#webauthn-totp-spinner')!;

  usernameManager: UsernameManager;

  get readonlyContract () {
    if( ! this._providers.swp ) {
      throw Error('Not connected!');
    }
    return WebAuthNExample__factory.connect(this._config.webauthContract, this._providers.swp);
  }

  constructor(private _providers:EthProviders, private _config:AppConfig) {
    subscribe(_providers, this._onProvidersUpdate.bind(this));
    this.usernameManager = new UsernameManager(_providers, _config);
    this._onProvidersUpdate();
  }

  async _onProvidersUpdate () {
    //const disabled = ! this._providers.connected;
    const disabled = false;
    setDisabled(this.registerButton, disabled);
    setDisabled(this.testButton, disabled);
    setDisabled(this.totpButton, disabled);
  }

  async attach () {
    this.registerButton.addEventListener('click', this._onRegister.bind(this));
    this.testButton.addEventListener('click', this._onTest.bind(this));
    this.totpButton.addEventListener('click', this._onTOTP.bind(this));
    await this.usernameManager.attach();
  }

  async _onRegister () {
    setVisibility(this.registerSpinner, true);
    try {
      if( await this.usernameManager.checkUsername(false) )
      {
        this.registerStatus.innerText = 'Requesting WebAuthN Creation';
        const username = this.usernameManager.username;
        if( ! username ) {
          throw new Error('requires username');
        }
        const hashedUsername = await this.usernameManager.hashedUsername();
        const challenge = crypto.getRandomValues(new Uint8Array(32));

        let cred;
        try {
          cred = await credentialCreate({
            name: "Sapphire-Auth[ZN]",
            id: window.location.hostname
          }, {
            id: hashedUsername,
            name: username,
            displayName: username
          }, challenge);
        }
        catch( e: any ) {
          this.registerStatus.innerText = `${e}`;
          return;
        }

        try {
          // Request that contract signs our registration transaction
          const provider = this.readonlyContract.runner!.provider!;
          const gasPrice = (await provider.getFeeData())!.gasPrice!;
          const nonce = await provider.getTransactionCount(await this.readonlyContract.gaspayingAddress());
          const signedTx = await this.readonlyContract.gasless_registerECES256P256(
            {
              hashedUsername: hashedUsername,
              credentialId: cred.id,
              pubkey: cred.ad.attestedCredentialData!.credentialPublicKey!,
              optionalPassword: ZeroHash
            },
            nonce, gasPrice);

          // Then send the returned transaction and wait for it to be confirmed
          const txHash = await this._providers.up!.send('eth_sendRawTransaction', [signedTx]) as string;
          this.registerStatus.innerText = `Registering (tx: ${txHash})`;
          await this._providers.up?.waitForTransaction(txHash);
          const tx = (await this._providers.swp?.getTransaction(txHash))!;
          const receipt = await tx.wait();
          this.registerStatus.innerText = `Registered (block: ${receipt!.blockNumber}, tx: ${tx.hash}, gas: ${receipt!.gasUsed})`;
        }
        catch( e:any ) {
          if( e.info && e.info.error ) {
            this.registerStatus.innerText = `${e.info.error.code}: ${e.info.error.message}`;
          }
          else {
            this.registerStatus.innerText = `${e}`;
          }
          return;
        }
      }
    }
    finally {
      setVisibility(this.registerSpinner, false);
    }
  } // _onRegister

  async makeAccountViewCall(calldata:string)
  {
    const provider = this.readonlyContract.runner!.provider!;
    const network = await provider.getNetwork();
    const chainId = network.chainId;

    // Construct personalized challenge hash of calldata etc.
    const accountIdHex = (await this.readonlyContract.getAddress()).slice(2);
    const saltHex = toBeHex(toBigInt(await this.usernameManager.salt()),32);
    const personalization = sha256('0x' + toBeHex(chainId!, 32).slice(2) + accountIdHex + saltHex.slice(2));
    const personalizedHash = sha256(personalization + sha256(calldata).slice(2));

    // Perform WebAuthN signing of challenge
    const challenge = toBeArray(personalizedHash);
    const hashedUsername = await this.usernameManager.hashedUsername();
    const credentials = await this.readonlyContract.credentialIdsByUsername(hashedUsername);
    const binaryCreds = credentials.map((_) => toBeArray(_));
    const authed = await credentialGet(binaryCreds, challenge);

    // Perform proxied view call with WebAuthN
    return await this.readonlyContract.proxyViewECES256P256(authed.credentialIdHashed, authed.resp, calldata);
  } // makeAccountViewCall

  async makeProxiedViewCall(address:string, calldata:string) : Promise<string>
  {
    const ai = Account__factory.createInterface();
    const outerCalldata = ai.encodeFunctionData("staticcall", [address, calldata]);
    const resp = await this.makeAccountViewCall(outerCalldata);
    return ai.decodeFunctionResult('staticcall', resp).out_data;
  } // makeProxiedViewCall

  async _onTest () {
    setVisibility(this.testSpinner, true);
    try {
      if( await this.usernameManager.checkUsername(true) ) {
        this.testStatus.innerText = 'Fetching Credentials';

        const ai = Account__factory.createInterface();
        const randStuff = crypto.getRandomValues(new Uint8Array(32));
        const calldata = ai.encodeFunctionData("sign", [randStuff]);

        const resp = await this.makeAccountViewCall(calldata);
        const respDecoded = ai.decodeFunctionResult('sign', resp);
        this.testStatus.innerText = `${respDecoded}`;
      }
    }
    catch( e:any ) {
      this.testStatus.innerText = `${e}`;
    }
    finally {
      setVisibility(this.testSpinner, false);
    }
  } // _onTest

  async _onTOTP () {
    setVisibility(this.totpSpinner, true);
    try {
      if( await this.usernameManager.checkUsername(true) ) {
        this.totpStatus.innerText = 'Fetching Credentials & Signing';

        const ti = TOTPExample__factory.createInterface();

        const secret = ti.decodeFunctionResult('deriveSecret', await this.makeProxiedViewCall(process.env.VITE_TOTP_CONTRACT!, ti.encodeFunctionData('deriveSecret')));
        const code = ti.decodeFunctionResult('generate', await this.makeProxiedViewCall(process.env.VITE_TOTP_CONTRACT!, ti.encodeFunctionData('generate')));

        this.totpStatus.innerText = `${secret} ${code}`;
      }
    }
    catch( e:any ) {
      this.totpStatus.innerText = `${e}`;
    }
    finally {
      setVisibility(this.totpSpinner, false);
    }
  } // _onTOTP
}

// ------------------------------------------------------------------

class App {
  providers: EthProviders;
  webauthnManager: WebAuthNManager;

  constructor (_config: AppConfig) {
    this.providers = new EthProviders(_config);
    this.webauthnManager = new WebAuthNManager(this.providers, _config);
    console.log('App Started', _config);
  }

  async attach () {
    await this.providers.attach();
    await this.webauthnManager.attach();
  }
}

// ------------------------------------------------------------------

declare global {
  var APP: App;
}

window.onload = async () => {
  const config = {
    sapphireJsonRpc: process.env.VITE_SAPPHIRE_JSONRPC!,
    webauthContract: process.env.VITE_WEBAUTH_ADDR!,
    sapphireChainId: parseInt(process.env.VITE_SAPPHIRE_CHAIN_ID!,16),
    totpContract: process.env.VITE_TOTP_CONTRACT!
  } as AppConfig;
  if( ! config.webauthContract ) {
    throw Error('No WebAuthNExample contract address specified! (VITE_WEBAUTH_ADDR)');
  }
  if( ! config.sapphireJsonRpc ) {
    throw new Error('No Sapphire JSON RPC endpoint provided! (VITE_SAPPHIRE_JSONRPC)')
  }

  globalThis.APP = new App(config);

  await globalThis.APP.attach();
}
