
export interface Partner {
  id: string;
  userId: string;
  publicKeyPem: string;
  nick: string;
  avatar?: string;
}

export interface AuthConfig {
  id: string;
  realPin: string;
  fakePin: string;
  nickname: string;
  avatar?: string;
  mood?: string;
  invisible?: boolean;
}

export interface MyIdentity {
  id: string;
  userId: string;
  publicKeyPem: string;
  privateKey: CryptoKey;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: number;
  status?: 'unread' | 'read' | 'delivered';
}
