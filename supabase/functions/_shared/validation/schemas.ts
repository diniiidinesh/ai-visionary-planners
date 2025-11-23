import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

// Store OAuth Token Schema
export const StoreOAuthTokenSchema = z.object({
  provider: z.string().min(1, "Provider is required"),
  accessToken: z.string().min(1, "Access token is required"),
  refreshToken: z.string().optional(),
  iv: z.string().min(1, "IV is required"),
  expiresIn: z.number().positive("Expires in must be positive"),
});

// AI Search Schema
export const AISearchSchema = z.object({
  query: z.string().min(1, "Query is required").max(1000, "Query too long"),
});

// AI Summarize Schema
export const AISummarizeSchema = z.object({
  question: z.string().min(1, "Question is required").max(1000, "Question too long"),
  documents: z.array(z.object({
    id: z.string(),
    name: z.string(),
    mimeType: z.string().optional(),
    webViewLink: z.string().optional(),
    modifiedTime: z.string().optional(),
    owners: z.array(z.object({
      displayName: z.string().optional(),
      emailAddress: z.string().optional(),
    })).optional(),
    content: z.string().optional(),
    relevanceScore: z.number().optional(),
  })).min(1, "At least one document is required").max(50, "Too many documents"),
  queryId: z.string().optional(),
});

// Multi Source Search Schema
export const MultiSourceSearchSchema = z.object({
  searchVariations: z.array(z.string()).min(1, "Search variations required").max(10, "Too many variations"),
  documentTypes: z.array(z.string()).optional(),
  entities: z.array(z.string()).optional(),
  originalQuery: z.string().min(1, "Original query is required").max(1000, "Query too long"),
  dateRange: z.string().optional(),
});
