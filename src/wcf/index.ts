import ffi from 'ffi-napi';
import path from 'path';
import { fileURLToPath } from 'url';
import { Socket } from '@rustup/nng';
import { wcf } from './proto/wcf';
import { WCFWxContact, WCFWxDBTable, WCFWxUserInfo } from './types';
import { parseDBField, sleep, toLocalFile } from './utils';
import { roomdata } from './proto/roomdata';
import * as lz4 from 'lz4-wasm-nodejs';
import lz4Napi from 'lz4-napi';
import oldLz4 from 'lz4';
import { readFileSync, writeFileSync } from 'fs';


const dirname = path.dirname(fileURLToPath(import.meta.url));
const wcfDir = path.join(dirname, 'lib');
const sdkPath = path.join(wcfDir, 'sdk.dll');
const cacheDir = path.join(dirname, 'cache');

const wcfSDK = ffi.Library(sdkPath, {
  WxInitSDK: ['int', ['bool', 'int']],
  WxDestroySDK: ['void', []],
});

const CMD_HOST = "127.0.0.1";
const CMD_PORT = 10086;

const MSG_HOST = "127.0.0.1";
const MSG_PORT = CMD_PORT + 1;

const DEBUG = true;

/**
 * 与WCF SDK的通信服务
 */
export default class WCFService {
  static readonly SYSTEM_WXID_MAP = {
    fmessage: '朋友推荐消息',
    medianote: '语音记事本',
    floatbottle: '漂流瓶',
    filehelper: '文件传输助手',
    newsapp: '新闻',
  };
  /**
   * 与WCF SDK的命令通信客户端
   */
  cmdClient = new Socket();
  /**
   * 是否正在接收消息
   */
  isReceivingMsg = false;
  /**
   * 是否接收朋友圈动态
   */
  recvFriendDynamic = false;
  /**
   * 僵尸XML消息，专门用来发送XML的
   */
  xmlMsgId = "";

  constructor() {
    this.registerCleanUp();
  };

  /**
   * 初始化WCF服务
   * @param debug 
   */
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

  /**
   * 销毁WCF服务
   */
  destroy() {
    wcfSDK.WxDestroySDK();
  }

  /**
   * 注册清理函数
   */
  registerCleanUp() {
    process.once('exit', () => {
      this.destroy();
    });
  }

  /**
   * 向WCF SDK发送命令
   * @param req 
   * @returns 
   */
  wcfCall(req: wcf.Request) {
    if (!this.cmdClient.connected()) {
      throw new Error('WCF命令服务器未连接');
    }
    const data = req.serialize();
    // cmdClient发送消息
    const res = this.cmdClient.send(Buffer.from(data));
    return wcf.Response.deserialize(res);
  }

  /**
   * 连接WCF SDK的命令服务器
   */
  initCMDClient() {
    this.cmdClient.connect(`tcp://${CMD_HOST}:${CMD_PORT}`);
  }

  /**
   * 连接WCF SDK的消息服务器
   * @returns 
   */
  initMsgClient() {
    if (this.isReceivingMsg) {
      return true;
    }
    Socket.recvMessage(`tcp://${MSG_HOST}:${MSG_PORT}`, null, this.handleMsgResponse);
    this.isReceivingMsg = true;
  }

  /**
   * 消息处理回调
   * @param err 
   * @param res 
   */
  handleMsgResponse(err: Error | undefined, res: Buffer) {
    if (err) {
      // console.error('handleCMDResponse:', err);
    } else {
      // console.log('handleCMDResponse:', res);
      const decodeRes = wcf.Response.deserialize(Uint8Array.from(res));
      // console.log('decodeRes:', decodeRes);
      if (DEBUG) {
        const objRes = decodeRes.toObject();
        console.log(objRes.wxmsg, objRes.wxmsg?.content);
      }
    }
  }

  // -----------------------------  以下是SDK的API封装  ------------------------
  /**
   * 启动消息监听
   * @returns 
   */
  enableRecvMsg() {
    return this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_ENABLE_RECV_TXT,
      flag: this.recvFriendDynamic,
    }));
  }

  /**
   * 停止消息监听
   * @returns 
   */
  disableRecvMsg() {
    return this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_DISABLE_RECV_TXT,
    }));
  }

  /**
   * 账号是否登录
   * @returns 
   */
  isLogin(): boolean {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_IS_LOGIN,
    }));
    return res.status === 1;
  }

  /**
   * 获取登录账号的wxid
   * @returns 
   */
  getSelfWxid(): string {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_GET_SELF_WXID,
    }));
    return res.str;
  }

  /**
   * 获取登录账号的信息
   * @returns 
   */
  getSelfInfo(): WCFWxUserInfo {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_GET_USER_INFO,
    }))
    return res.ui;
  }

  /**
   * 获取联系人列表
   * @returns 
   */
  getContactList(): WCFWxContact[] {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_GET_CONTACTS,
    }));
    return res.contacts.contacts.map((contact) => contact.toObject() as WCFWxContact);
  }

  /**
   * 通过wxid获取联系人信息
   * @param wxid 
   * @returns 
   */
  getContactByWxid(wxid: string): WCFWxContact {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_GET_CONTACT_INFO,
      str: wxid,
    }));
    return res.contacts.contacts[0].toObject() as WCFWxContact;
  }

  /**
   * 获取数据库名称列表
   * @returns 
   */
  getDBNameList(): string[] {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_GET_DB_NAMES,
    }));
    return res.dbs.names;
  }

  /**
   * 获取数据库表列表
   * @param dbName 
   * @returns 
   */
  getDBTableList(dbName: string): WCFWxDBTable[] {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_GET_DB_TABLES,
      str: dbName,
    }));
    return res.tables.tables.map((table) => table.toObject() as WCFWxDBTable);
  }

  /**
   * 执行数据库查询
   * @param db 
   * @param sql 
   * @returns 
   */
  execSql(db: string, sql: string): any {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_EXEC_DB_QUERY,
      query: new wcf.DbQuery({ db, sql }),
    }));
    const rows = res.rows.rows;
    return rows.map((r) =>
      Object.fromEntries(
        r.fields.map((f) => [f.column, parseDBField(f.type, f.content)])
      )
    );
  }

  /**
   * 获取消息类型
   * @returns 
   */
  getMsgType() {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_GET_MSG_TYPES,
    }));
    return res.types.types;
  }

  /**
   * 刷新朋友圈动态
   */
  refreshFriendDynamic() {
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_REFRESH_PYQ,
    }));
    return res.status === 1;
  }

  /**
   * 获取群聊列表
   */
  getChatRoomList() {
    return this.getContactList().filter((contact) => contact.wxid.endsWith('@chatroom'));
  }

  /**
   * 获取好友列表
   */
  getFriendList() {
    return this.getContactList().filter((contact) => !contact.wxid.endsWith('@chatroom') && !contact.wxid.startsWith("gh_") && !Object.prototype.hasOwnProperty.call(WCFService.SYSTEM_WXID_MAP, contact.wxid));
  }

  /**
   * 通过wxid获取昵称
   * @param wxids 
   * @returns 
   */
  getNickNameByWxid(wxids: string[]) {
    const res = this.execSql('MicroMsg.db',
      `SELECT UserName, NickName FROM Contact WHERE UserName in (${wxids
        .map((id) => `'${id}'`)
        .join(',')});`);
    return Object.fromEntries(res.map((row: any) => [row['UserName'], row['NickName'] as string | undefined]));
  }

  /**
   * 获取群聊成员列表
   * @param chatRoomId 
   * @param retryTimes 
   * @returns 
   */
  async getChatRoomMemberList(chatRoomId: string, retryTimes = 5): Promise<Record<string, string>> {
    if (retryTimes <= 0) {
      return {};
    }
    const [room] = this.execSql(
      'MicroMsg.db',
      `SELECT RoomData FROM ChatRoom WHERE ChatRoomName = '${chatRoomId}';`
    );
    if (!room) {
      await sleep(1000);
      return this.getChatRoomMemberList(chatRoomId, retryTimes - 1);
    }
    const r = roomdata.RoomData.deserialize(
      room['RoomData'] as Buffer
    );
    const userRds = this.execSql(
      'MicroMsg.db',
      'SELECT Alias, UserName, NickName FROM Contact;'
    );
    const userDict = Object.fromEntries(
      userRds.map((u: any) => [u['UserName'], {
        alias: u['Alias'],
        nickName: u['NickName'],
        wxid: u['UserName'],
      }])
    );
    return Object.fromEntries(
      r.members.map((member) => [
        member.wxid,
        userDict[member.wxid] || {},
      ])
    );
  }

  /**
 * 邀请群成员
 * @param chatRoomId
 * @param wxids
 */
  inviteChatroomMembers(chatRoomId: string, wxids: string[]): boolean {
    const req = new wcf.Request({
      func: wcf.Functions.FUNC_INV_ROOM_MEMBERS,
      m: new wcf.MemberMgmt({
        roomid: chatRoomId,
        wxids: wxids.join(',').replaceAll(' ', ''),
      }),
    });
    const res = this.wcfCall(req);
    return res.status === 1;
  }

  /**
   * 添加群成员
   * @param chatRoomId
   * @param wxids
   */
  addChatRoomMembers(chatRoomId: string, wxids: string[]): number {
    const req = new wcf.Request({
      func: wcf.Functions.FUNC_ADD_ROOM_MEMBERS,
      m: new wcf.MemberMgmt({
        roomid: chatRoomId,
        wxids: wxids.join(',').replaceAll(' ', ''),
      }),
    });
    const res = this.wcfCall(req);
    return res.status;
  }

  /**
   * 删除群成员
   * @param chatRoomId
   * @param wxids
   */
  delChatRoomMembers(chatRoomId: string, wxids: string[]): number {
    const req = new wcf.Request({
      func: wcf.Functions.FUNC_DEL_ROOM_MEMBERS,
      m: new wcf.MemberMgmt({
        roomid: chatRoomId,
        wxids: wxids.join(',').replaceAll(' ', ''),
      }),
    });
    const rsp = this.wcfCall(req);
    return rsp.status;
  }

  /**
 * 撤回消息
 * @param msgId (uint64, bigInt) 消息ID
 */
  revokeMsg(msgId: string | bigint): boolean {
    const req = new wcf.Request({
      func: wcf.Functions.FUNC_REVOKE_MSG,
      ui64: msgId.toString(),
    });
    const res = this.wcfCall(req);
    return res.status === 1;
  }

  /**
   * 转发消息。可以转发文本、图片、表情、甚至各种 XML；语音会变成 `[语音]`
   * @param msgId (uint64 in string format): 消息 id
   * @param receiver string 消息接收人，wxid 或者 roomid
   * @returns int: 1 为成功，其他失败
   */
  forwardMsg(msgId: string | bigint, receiver: string): number {
    const req = new wcf.Request({
      func: wcf.Functions.FUNC_FORWARD_MSG,
      fm: new wcf.ForwardMsg({
        id: msgId.toString(),
        receiver,
      }),
    });
    const res = this.wcfCall(req);
    return res.status;
  }

  /**
   * 发送文本消息
   * @param msg 要发送的消息，换行使用 `\n` （单杠）；如果 @ 人的话，需要带上跟 `aters` 里数量相同的 @
   * @param receiver 消息接收人，wxid 或者 roomid
   * @param aters 要 @ 的 wxid，多个用逗号分隔；`@所有人` 只需要 `notify@all`
   * @returns 0 为成功，其他失败
   */
  sendTxt(msg: string, receiver: string, aters?: string): number {
    const req = new wcf.Request({
      func: wcf.Functions.FUNC_SEND_TXT,
      txt: new wcf.TextMsg({
        msg,
        receiver,
        aters,
      }),
    });
    const res = this.wcfCall(req);
    return res.status;
  }

  /**
   * 发送图片消息
   * @param imagePath 
   * @param receiver 
   * @returns 
   */
  async sendImage(imagePath: string, receiver: string): Promise<boolean> {
    const {
      filePath,
      cleanUp,
    } = await toLocalFile({
      name: imagePath.split('/').pop() as string || `${Date.now()}`,
      dir: cacheDir,
      file: imagePath,
    });
    console.log('download success', filePath);
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_SEND_IMG,
      file: new wcf.PathMsg({
        path: filePath,
        receiver,
      }),
    }));
    cleanUp();
    return res.status === 1;
  }

  /**
   * 发送文件消息
   * @param imagePath 
   * @param receiver 
   * @returns 
   */
  async sendFile(imagePath: string, receiver: string): Promise<boolean> {
    const {
      filePath,
      cleanUp,
    } = await toLocalFile({
      name: imagePath.split('/').pop() as string || `${Date.now()}`,
      dir: cacheDir,
      file: imagePath,
    });
    console.log('download success', filePath);
    const res = this.wcfCall(new wcf.Request({
      func: wcf.Functions.FUNC_SEND_FILE,
      file: new wcf.PathMsg({
        path: filePath,
        receiver,
      }),
    }));
    cleanUp();
    return res.status === 1;
  }

  /**
   * 发送 XML 消息
   * @param xml 
   * @param receiver 
   * @returns 
   */
  sendRawXML(
    xml: { content: string; path?: string; type: number },
    receiver: string
  ): boolean {
    const req = new wcf.Request({
      func: wcf.Functions.FUNC_SEND_XML,
      xml: new wcf.XmlMsg({
        receiver,
        content: xml.content,
        type: xml.type,
        path: xml.path,
      }),
    });
    const res = this.wcfCall(req);
    return res.status === 1;
  }

  /**
   * 替代发送 XML 消息
   * @param xml 
   * @param receiver 
   * @returns 
   */
  async sendAlternativeXML(
    xml: string,
    receiver: string
  ) {
    // const msg = this.execSql("MSG0.db", `select * from MSG where type = 49 LIMIT 1;`)[0];
    const recoverMode = false;
    if (recoverMode) {
      const msg = this.execSql("MSG0.db", `select * from MSG where type = 49 LIMIT 1;`)[0];
      this.recoverMsg();
      this.forwardMsg(msg.MsgSvrID, receiver);
    } else {
      const com_data = await lz4Napi.compress(xml);
      const hexString = Buffer.from(com_data).toString('hex');
      const MsgSvrID = `10${Date.now()}`;
      const sql = `UPDATE MSG SET MsgSvrId = ${MsgSvrID}, CompressContent = x'${hexString}',BytesExtra=x'' WHERE localId = 55`;
      this.execSql("MSG0.db", sql);
      console.log(sql);
      setTimeout(() => {
        this.forwardMsg(MsgSvrID, receiver);
      }, 1000)
    }
  }

  async recoverMsg() {
    const CompressContent = readFileSync("CompressContent.txt");
    const BytesExtra = readFileSync("BytesExtra.txt");

    this.execSql("MSG0.db", `UPDATE MSG SET CompressContent = x'${CompressContent}',BytesExtra=x'${BytesExtra}' WHERE localId = 55;`);
  }
}

