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
    PostgrestVersion: "14.17"
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
      conversation_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          sources: Json | null
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          sources?: Json | null
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          sources?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      document_chunks: {
        Row: {
          author: string | null
          char_count: number | null
          chunk_index: number
          chunk_overlap: number | null
          chunk_size: number | null
          content: string
          content_hash: string | null
          content_tsv: unknown
          created_at: string
          doc_created_time: string | null
          doc_modified_time: string | null
          embedding: string
          embedding_model: string
          embedding_voyage: string | null
          embedding_voyage_model: string | null
          folder_path: string | null
          full_url: string | null
          heading: string | null
          id: string
          metadata_version: number
          mime_type: string | null
          source_id: string
          source_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author?: string | null
          char_count?: number | null
          chunk_index: number
          chunk_overlap?: number | null
          chunk_size?: number | null
          content: string
          content_hash?: string | null
          content_tsv?: unknown
          created_at?: string
          doc_created_time?: string | null
          doc_modified_time?: string | null
          embedding: string
          embedding_model: string
          embedding_voyage?: string | null
          embedding_voyage_model?: string | null
          folder_path?: string | null
          full_url?: string | null
          heading?: string | null
          id?: string
          metadata_version?: number
          mime_type?: string | null
          source_id: string
          source_type?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          author?: string | null
          char_count?: number | null
          chunk_index?: number
          chunk_overlap?: number | null
          chunk_size?: number | null
          content?: string
          content_hash?: string | null
          content_tsv?: unknown
          created_at?: string
          doc_created_time?: string | null
          doc_modified_time?: string | null
          embedding?: string
          embedding_model?: string
          embedding_voyage?: string | null
          embedding_voyage_model?: string | null
          folder_path?: string | null
          full_url?: string | null
          heading?: string | null
          id?: string
          metadata_version?: number
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
          author: string | null
          chunk_count: number
          chunk_overlap: number | null
          chunk_size: number | null
          content_hash: string | null
          content_snippet: string | null
          created_at: string | null
          doc_created_time: string | null
          embedding_model: string | null
          folder_path: string | null
          full_url: string | null
          id: string
          ingest_attempts: number
          ingest_error: string | null
          ingest_status: string
          last_synced: string | null
          metadata: Json | null
          metadata_version: number
          source_id: string
          source_modified_time: string | null
          source_type: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author?: string | null
          chunk_count?: number
          chunk_overlap?: number | null
          chunk_size?: number | null
          content_hash?: string | null
          content_snippet?: string | null
          created_at?: string | null
          doc_created_time?: string | null
          embedding_model?: string | null
          folder_path?: string | null
          full_url?: string | null
          id?: string
          ingest_attempts?: number
          ingest_error?: string | null
          ingest_status?: string
          last_synced?: string | null
          metadata?: Json | null
          metadata_version?: number
          source_id: string
          source_modified_time?: string | null
          source_type: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          author?: string | null
          chunk_count?: number
          chunk_overlap?: number | null
          chunk_size?: number | null
          content_hash?: string | null
          content_snippet?: string | null
          created_at?: string | null
          doc_created_time?: string | null
          embedding_model?: string | null
          folder_path?: string | null
          full_url?: string | null
          id?: string
          ingest_attempts?: number
          ingest_error?: string | null
          ingest_status?: string
          last_synced?: string | null
          metadata?: Json | null
          metadata_version?: number
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
          auto_sync_daily: boolean
          created_at: string | null
          debug_retrieval: boolean
          embedding_provider: string
          enable_cost_tracking: boolean | null
          id: string
          max_output_tokens: number
          max_passages_per_doc: number
          min_similarity: number
          monthly_budget_usd: number | null
          passages_to_model: number
          retrieval_mode: string
          retrieval_top_k: number
          search_model: string | null
          search_org_id: string | null
          search_provider: string | null
          summarize_model: string | null
          summarize_org_id: string | null
          summarize_provider: string | null
          temperature: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          auto_sync_daily?: boolean
          created_at?: string | null
          debug_retrieval?: boolean
          embedding_provider?: string
          enable_cost_tracking?: boolean | null
          id?: string
          max_output_tokens?: number
          max_passages_per_doc?: number
          min_similarity?: number
          monthly_budget_usd?: number | null
          passages_to_model?: number
          retrieval_mode?: string
          retrieval_top_k?: number
          search_model?: string | null
          search_org_id?: string | null
          search_provider?: string | null
          summarize_model?: string | null
          summarize_org_id?: string | null
          summarize_provider?: string | null
          temperature?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          auto_sync_daily?: boolean
          created_at?: string | null
          debug_retrieval?: boolean
          embedding_provider?: string
          enable_cost_tracking?: boolean | null
          id?: string
          max_output_tokens?: number
          max_passages_per_doc?: number
          min_similarity?: number
          monthly_budget_usd?: number | null
          passages_to_model?: number
          retrieval_mode?: string
          retrieval_top_k?: number
          search_model?: string | null
          search_org_id?: string | null
          search_provider?: string | null
          summarize_model?: string | null
          summarize_org_id?: string | null
          summarize_provider?: string | null
          temperature?: number
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
      embedding_coverage_by_document: {
        Args: never
        Returns: {
          openai_chunks: number
          openai_model: string
          source_id: string
          total_chunks: number
          voyage_chunks: number
          voyage_model: string
        }[]
      }
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
      match_document_chunks_hybrid: {
        Args: {
          match_count?: number
          p_keyword_weight?: number
          p_min_similarity?: number
          p_source_type?: string
          p_vector_weight?: number
          query_embedding: string
          query_text: string
        }
        Returns: {
          author: string
          chunk_index: number
          content: string
          doc_modified_time: string
          full_url: string
          fused_score: number
          heading: string
          id: string
          keyword_rank: number
          keyword_score: number
          mime_type: string
          similarity: number
          source_id: string
          source_type: string
          title: string
          vector_rank: number
        }[]
      }
      match_document_chunks_hybrid_multi: {
        Args: {
          match_count?: number
          p_keyword_weight?: number
          p_min_similarity?: number
          p_source_type?: string
          p_vector_weight?: number
          query_embedding: string
          query_texts: string[]
        }
        Returns: {
          author: string
          chunk_index: number
          content: string
          doc_modified_time: string
          full_url: string
          fused_score: number
          heading: string
          id: string
          keyword_rank: number
          keyword_score: number
          mime_type: string
          similarity: number
          source_id: string
          source_type: string
          title: string
          vector_rank: number
        }[]
      }
      match_document_chunks_hybrid_space: {
        Args: {
          match_count: number
          p_embedding_space: string
          p_keyword_weight?: number
          p_min_similarity?: number
          p_source_type?: string
          p_vector_weight?: number
          query_embedding_openai: string
          query_embedding_voyage: string
          query_texts: string[]
        }
        Returns: {
          author: string
          chunk_index: number
          content: string
          doc_modified_time: string
          full_url: string
          fused_score: number
          heading: string
          id: string
          keyword_rank: number
          keyword_score: number
          mime_type: string
          similarity: number
          source_id: string
          source_type: string
          title: string
          vector_rank: number
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
