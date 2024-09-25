import { wcf } from "./proto/wcf";

/**
 * 将WCF SDK的对象转换为普通对象
 */
export type ToPlainType<T extends { toObject: () => unknown }> = Required<ReturnType<T['toObject']>>;

/**
 * WCF SDK的微信用户信息
 */
export type WCFWxUserInfo = ToPlainType<wcf.UserInfo>

/**
 * WCF SDK的微信联系人信息
 */
export type WCFWxContact = ToPlainType<wcf.RpcContact>

/**
 * WCF SDK的微信数据库表
 */
export type WCFWxDBTable = ToPlainType<wcf.DbTable>

/**
 * WCF SDK的微信聊天室成员信息
 */
export type WCFWxChatRoomMemberInfo = {
  alias?: string;
  nickName: string;
  wxid: string;
}

/**
 * WCF SDK的微信数据库字段类型枚举
 */
export enum WCFWxDBFiledType {
  INT = 1,
  FLOAT = 2,
  // lambda x: x.decode("utf-8")
  LAMBDA = 3,
  BYTES = 4,
  // lambda x: None
  NONE = 5,
}
