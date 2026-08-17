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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_usage_logs: {
        Row: {
          completion_tokens: number | null
          created_at: string | null
          estimated_cost_usd: number | null
          id: string
          model: string
          prompt_tokens: number | null
          provider: string
          purpose: string
          response_time_ms: number | null
          total_tokens: number | null
          user_id: string
        }
        Insert: {
          completion_tokens?: number | null
          created_at?: string | null
          estimated_cost_usd?: number | null
          id?: string
          model: string
          prompt_tokens?: number | null
          provider: string
          purpose: string
          response_time_ms?: number | null
          total_tokens?: number | null
          user_id: string
        }
        Update: {
          completion_tokens?: number | null
          created_at?: string | null
          estimated_cost_usd?: number | null
          id?: string
          model?: string
          prompt_tokens?: number | null
          provider?: string
          purpose?: string
          response_time_ms?: number | null
          total_tokens?: number | null
          user_id?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          char_count: number | null
          chunk_index: number
          content: string
          content_hash: string | null
          created_at: string
          embedding: string
          embedding_model: string
          full_url: string | null
          id: string
          mime_type: string | null
          source_id: string
          source_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          char_count?: number | null
          chunk_index: number
          content: string
          content_hash?: string | null
          created_at?: string
          embedding: string
          embedding_model: string
          full_url?: string | null
          id?: string
          mime_type?: string | null
          source_id: string
          source_type?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          char_count?: number | null
          chunk_index?: number
          content?: string
          content_hash?: string | null
          created_at?: string
          embedding?: string
          embedding_model?: string
          full_url?: string | null
          id?: string
          mime_type?: string | null
          source_id?: string
          source_type?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      document_index: {
        Row: {
          chunk_count: number
          content_hash: string | null
          content_snippet: string | null
          created_at: string | null
          full_url: string | null
          id: string
          ingest_error: string | null
          ingest_status: string
          last_synced: string | null
          metadata: Json | null
          source_id: string
          source_modified_time: string | null
          source_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          chunk_count?: number
          content_hash?: string | null
          content_snippet?: string | null
          created_at?: string | null
          full_url?: string | null
          id?: string
          ingest_error?: string | null
          ingest_status?: string
          last_synced?: string | null
          metadata?: Json | null
          source_id: string
          source_modified_time?: string | null
          source_type: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          chunk_count?: number
          content_hash?: string | null
          content_snippet?: string | null
          created_at?: string | null
          full_url?: string | null
          id?: string
          ingest_error?: string | null
          ingest_status?: string
          last_synced?: string | null
          metadata?: Json | null
          source_id?: string
          source_modified_time?: string | null
          source_type?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      oauth_connections: {
        Row: {
          created_at: string | null
          id: string
          is_connected: boolean | null
          provider: string
          token_expiry: string | null
          updated_at: string | null
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_connected?: boolean | null
          provider: string
          token_expiry?: string | null
          updated_at?: string | null
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_connected?: boolean | null
          provider?: string
          token_expiry?: string | null
          updated_at?: string | null
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
      oauth_states: {
        Row: {
          created_at: string
          expires_at: string
          post_message_origin: string | null
          provider: string
          return_url: string | null
          state: string
          used: boolean
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          post_message_origin?: string | null
          provider: string
          return_url?: string | null
          state: string
          used?: boolean
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          post_message_origin?: string | null
          provider?: string
          return_url?: string | null
          state?: string
          used?: boolean
          user_id?: string
        }
        Relationships: []
      }
      search_queries: {
        Row: {
          created_at: string | null
          id: string
          original_query: string
          processed_queries: Json | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          original_query: string
          processed_queries?: Json | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          original_query?: string
          processed_queries?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      search_results: {
        Row: {
          ai_summary: string
          created_at: string | null
          id: string
          model_used: string | null
          search_query_id: string
          sources_used: Json | null
          user_id: string
        }
        Insert: {
          ai_summary: string
          created_at?: string | null
          id?: string
          model_used?: string | null
          search_query_id: string
          sources_used?: Json | null
          user_id: string
        }
        Update: {
          ai_summary?: string
          created_at?: string | null
          id?: string
          model_used?: string | null
          search_query_id?: string
          sources_used?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_results_search_query_id_fkey"
            columns: ["search_query_id"]
            isOneToOne: false
            referencedRelation: "search_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_preferences: {
        Row: {
          created_at: string | null
          enable_cost_tracking: boolean | null
          id: string
          monthly_budget_usd: number | null
          search_model: string | null
          search_org_id: string | null
          search_provider: string | null
          summarize_model: string | null
          summarize_org_id: string | null
          summarize_provider: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          enable_cost_tracking?: boolean | null
          id?: string
          monthly_budget_usd?: number | null
          search_model?: string | null
          search_org_id?: string | null
          search_provider?: string | null
          summarize_model?: string | null
          summarize_org_id?: string | null
          summarize_provider?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          enable_cost_tracking?: boolean | null
          id?: string
          monthly_budget_usd?: number | null
          search_model?: string | null
          search_org_id?: string | null
          search_provider?: string | null
          summarize_model?: string | null
          summarize_org_id?: string | null
          summarize_provider?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_api_keys: {
        Row: {
          created_at: string | null
          id: string
          provider: string
          updated_at: string | null
          user_id: string
          vault_secret_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          provider: string
          updated_at?: string | null
          user_id: string
          vault_secret_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          provider?: string
          updated_at?: string | null
          user_id?: string
          vault_secret_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_oauth_tokens: {
        Args: { p_provider: string; p_user_id: string }
        Returns: Json
      }
      get_user_api_key: {
        Args: { p_provider: string; p_user_id: string }
        Returns: Json
      }
      match_document_chunks: {
        Args: {
          match_count?: number
          p_min_similarity?: number
          p_source_type?: string
          query_embedding: string
        }
        Returns: {
          chunk_index: number
          content: string
          full_url: string
          id: string
          mime_type: string
          similarity: number
          source_id: string
          source_type: string
          title: string
        }[]
      }
      store_encrypted_oauth_tokens: {
        Args: {
          p_access_token: string
          p_provider: string
          p_refresh_token: string
          p_token_expiry: string
          p_user_id: string
        }
        Returns: string
      }
      store_user_api_key: {
        Args: { p_api_key: string; p_provider: string; p_user_id: string }
        Returns: string
      }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
