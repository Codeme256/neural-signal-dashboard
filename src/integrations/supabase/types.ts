export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tracked_signals: {
        Row: {
          action: string
          checked_at: number | null
          closed_at: number | null
          decimals: number
          deriv_symbol: string
          entry: number
          id: string
          score: number
          signal_time: number
          status: string
          stop_loss: number
          strategy: string | null
          symbol: string
          take_profit1: number
          take_profit2: number
          target: string | null
          timeframe: string
          tracked_at: number
          user_id: string
        }
        Insert: {
          action: string
          checked_at?: number | null
          closed_at?: number | null
          decimals: number
          deriv_symbol: string
          entry: number
          id: string
          score: number
          signal_time: number
          status?: string
          stop_loss: number
          strategy?: string | null
          symbol: string
          take_profit1: number
          take_profit2: number
          target?: string | null
          timeframe: string
          tracked_at: number
          user_id: string
        }
        Update: {
          action?: string
          checked_at?: number | null
          closed_at?: number | null
          decimals?: number
          deriv_symbol?: string
          entry?: number
          id?: string
          score?: number
          signal_time?: number
          status?: string
          stop_loss?: number
          strategy?: string | null
          symbol?: string
          take_profit1?: number
          take_profit2?: number
          target?: string | null
          timeframe?: string
          tracked_at?: number
          user_id?: string
        }
        Relationships: []
      }
      scan_sessions: {
        Row: { user_id: string; id: string; started_at: number; finished_at: number; timeframe: string; section: string; analysis_count: number; data_source: string; sample_type: string }
        Insert: { user_id: string; id: string; started_at: number; finished_at: number; timeframe: string; section?: string; analysis_count?: number; data_source?: string; sample_type?: string }
        Update: { user_id?: string; id?: string; started_at?: number; finished_at?: number; timeframe?: string; section?: string; analysis_count?: number; data_source?: string; sample_type?: string }
        Relationships: []
      }
      scan_results: {
        Row: { user_id: string; scan_id: string; deriv_symbol: string; symbol: string; category: string; timeframe: string; strategy: string | null; direction: string; candle_time: number | null; scanned_at: number; entry: number | null; stop_loss: number | null; tp1: number | null; tp2: number | null; indicator_snapshot: Json; market_regime: string | null; data_status: string; error_reason: string | null; opportunity_id: string | null; verified_outcome: string | null; resolved_at: number | null }
        Insert: { user_id: string; scan_id: string; deriv_symbol: string; symbol: string; category: string; timeframe: string; strategy?: string | null; direction: string; candle_time?: number | null; scanned_at: number; entry?: number | null; stop_loss?: number | null; tp1?: number | null; tp2?: number | null; indicator_snapshot?: Json; market_regime?: string | null; data_status: string; error_reason?: string | null; opportunity_id?: string | null; verified_outcome?: string | null; resolved_at?: number | null }
        Update: { user_id?: string; scan_id?: string; deriv_symbol?: string; symbol?: string; category?: string; timeframe?: string; strategy?: string | null; direction?: string; candle_time?: number | null; scanned_at?: number; entry?: number | null; stop_loss?: number | null; tp1?: number | null; tp2?: number | null; indicator_snapshot?: Json; market_regime?: string | null; data_status?: string; error_reason?: string | null; opportunity_id?: string | null; verified_outcome?: string | null; resolved_at?: number | null }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
