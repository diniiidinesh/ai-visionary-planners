import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';

// Store OAuth Token Validation
export const StoreOAuthTokenSchema = z.object({
  provider: z.string().min(1, 'Provider is required').max(50),
  accessToken: z.string().min(1, 'Access token is required'),
  refreshToken: z.string().optional(),
  iv: z.string().min(1, 'IV is required'),
  expiresIn: z.number().positive('Expires in must be positive').max(31536000), // Max 1 year
});

// AI Search Validation
export const AISearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(1000, 'Query too long'),
});

// AI Summarize Validation
export const AISummarizeSchema = z.object({
  question: z.string().min(1, 'Question is required').max(1000, 'Question too long'),
  documents: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      mimeType: z.string().optional(),
      webViewLink: z.string().url().optional(),
      modifiedTime: z.string().optional(),
      owners: z.array(z.object({
        displayName: z.string().optional(),
        emailAddress: z.string().optional(),
      })).optional(),
      relevanceScore: z.number().optional(),
      source: z.string().optional(),
      content: z.string().optional(),
    })
  ).min(1, 'At least one document is required').max(50, 'Too many documents'),
  queryId: z.string().uuid().optional(),
});

// Multi-Source Search Validation
export const MultiSourceSearchSchema = z.object({
  searchVariations: z.array(z.string().max(500)).optional().default([]),
  documentTypes: z.array(z.string().max(50)).optional().default([]),
  entities: z.array(z.string().max(200)).optional().default([]),
  originalQuery: z.string().min(1, 'Original query is required').max(1000),
  dateRange: z.enum(['all', 'week', 'month', 'quarter', 'year']).optional().default('all'),
});
