import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SampleChunk {
  index: number;
  content: string;
  overlap: string;
}

const BOOK_TITLE = "The Little Prince";

// Privacy-screened excerpts from an indexed published book. Keeping this sample
// static prevents the public Pipeline page from exposing arbitrary Drive content.
const SAMPLE_CHUNKS: SampleChunk[] = [
  {
    index: 3,
    overlap: "",
    content:
      "I have lived a great deal among grown-ups. I have seen them intimately, close at hand. And that hasn't much improved my opinion of them. Whenever I met one of them who seemed to me at all clear-sighted, I tried the experiment of showing him my Drawing Number One, which I have always kept. I would try to find out, so, if this was a person of true understanding. But, whoever it was, he, or she, would always say: ‘That is a hat.’ Then I would never talk to that person about boa constrictors, or primeval forests, or stars. I would bring myself down to his level. I would talk to him about bridge, and golf, and politics, and neckties.",
  },
  {
    index: 4,
    overlap:
      "The first night, then, I went to sleep on the sand, a thousand miles from any human habitation. I was more isolated than a shipwrecked sailor on a raft in the middle of the ocean.",
    content:
      " Thus you can imagine my amazement, at sunrise, when I was awakened by an odd little voice. It said: ‘If you please—draw me a sheep!’ ‘What!’ ‘Draw me a sheep!’ I jumped to my feet, completely thunderstruck. I blinked my eyes hard. I looked carefully all around me. And I saw a most extraordinary small person, who stood there examining me with great seriousness.",
  },
  {
    index: 5,
    overlap:
      "Nothing about him gave any suggestion of a child lost in the middle of the desert, a thousand miles from any human habitation.",
    content:
      " When at last I was able to speak, I said to him: ‘But—what are you doing here?’ And in answer he repeated, very slowly, as if he were speaking of a matter of great consequence: ‘If you please—draw me a sheep . . .’ When a mystery is too overpowering, one dare not disobey.",
  },
];

export const ChunkInspector = () => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">Sample chunk inspector</CardTitle>
      <CardDescription>
        Privacy-screened passages from an indexed published book. Repeated boundary text is the overlap,
        highlighted below.
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">{BOOK_TITLE}</span>
        <Badge variant="secondary">published book sample</Badge>
        <Badge variant="secondary">no contact details</Badge>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">chunk_size 1200</Badge>
        <Badge variant="secondary">overlap 200</Badge>
      </div>

      <div className="space-y-3">
        {SAMPLE_CHUNKS.map((chunk) => (
          <div key={chunk.index} className="rounded-md border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">chunk {chunk.index}</Badge>
              {chunk.overlap && (
                <span className="text-accent">carries {chunk.overlap.length} chars of overlap</span>
              )}
            </div>
            <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
              {chunk.overlap && (
                <span className="rounded bg-accent/15 text-accent-foreground/90">{chunk.overlap}</span>
              )}
              {chunk.content}
            </p>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);