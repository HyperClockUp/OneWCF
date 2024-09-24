import ffi from 'ffi-napi';
import path from 'path';
import { fileURLToPath } from 'url';
import { Socket } from '@rustup/nng';
import { wcf } from './proto/wcf';


const dirname = path.dirname(fileURLToPath(import.meta.url));
const wcfDir = path.join(dirname, 'lib');
const sdkPath = path.join(wcfDir, 'sdk.dll');

console.log('sdkPath:', sdkPath);

const wcfSDK = ffi.Library(sdkPath, {
  WxInitSDK: ['int', ['bool', 'int']],
  WxDestroySDK: ['void', []],
});



const CMD_HOST = "127.0.0.1";
const CMD_PORT = 10086;

const MSG_HOST = "127.0.0.1";
const MSG_PORT = CMD_PORT + 1;

const DEBUG = true;

console.log('wcfSDK:', wcfSDK);


export default class WCFService {
  cmdClient = new Socket();
  isReceivingMsg = false;
  recvFriendDynamic = false;


  constructor() {
    this.registerCleanUp();
  };


  sendCmd(req: wcf.Request) {
    if (!this.cmdClient.connected()) {
      throw new Error('WCF命令服务器未连接');
    }
    const data = req.serialize();
    // cmdClient发送消息
    const res = this.cmdClient.send(Buffer.from(data));
    return wcf.Response.deserialize(res);
  }

  registerCleanUp() {
    process.once('exit', () => {
      this.destroy();
    });
  }

  initCMDClient() {
    this.cmdClient.connect(`tcp://${CMD_HOST}:${CMD_PORT}`);
  }

  initMsgClient() {
    if (this.isReceivingMsg) {
      return true;
    }
    Socket.recvMessage(`tcp://${MSG_HOST}:${MSG_PORT}`, null, this.handleMsgResponse);
    this.isReceivingMsg = true;
  }

  handleMsgResponse(err: Error | undefined, res: wcf.Response) {
    if (err) {
      console.error('handleCMDResponse:', err);
    } else {
      console.log('handleCMDResponse:', res);
      const decodeRes = wcf.Response.deserialize(res);
      console.log('decodeRes:', decodeRes);
      const objRes = decodeRes.toObject();
      console.log('objRes:', objRes);
    }
  }

  enableRecvMsg() {
    return this.sendCmd(new wcf.Request({
      func: wcf.Functions.FUNC_ENABLE_RECV_TXT,
      flag: this.recvFriendDynamic,
    }));
  }

  disableRecvMsg() {
    return this.sendCmd(new wcf.Request({
      func: wcf.Functions.FUNC_DISABLE_RECV_TXT,
    }));
  }

  async init(debug: boolean = DEBUG) {
    const initSDKRes = wcfSDK.WxInitSDK(debug, CMD_PORT);
    if (initSDKRes !== 0) {
      throw new Error('WxInitSDK failed');
    }
    this.initCMDClient();
    this.disableRecvMsg();
    this.enableRecvMsg();
    this.initMsgClient();
  }
  destroy() {
    wcfSDK.WxDestroySDK();
  }
}

