export interface RawChatRow {
  cid: string;
  title: string;
  pinned: boolean;
  timestamp: number;
}

export interface RawChatTurn {
  role: string;
  text: string;
}

export interface RawAvailableModel {
  model_id: string;
  model_name?: string;
  display_name?: string;
}
