// Mock OCR / vision provider for the frontend demo.
// In production this is the backend call to Azure AI Vision Read API v4.0 or Google Cloud Vision API (v1)
// on the header-masked image. Here we return deterministic text for the bundled sample pages so the
// UI can demonstrate unclear words, unsupported content, blank answers and continuations.
import layout from "./sample-layout.json";
import type { Rect } from "./types";

type Seg = [string, number | "unknown"];
export type OcrBlock = { lines: Seg[][]; unsupported?: string; continues?: boolean };

const BLOCKS: Record<string, OcrBlock> = {
  "s1p1:Q1": {
    lines: [
      [["Q1. A process is a program in execution. It has its", 0.96]],
      [["own address space, program counter and resources.", 0.94]],
      [["A", 0.97], ["thraed", 0.48], ["is a lightweight unit inside a process.", 0.95]],
      [["Threads share memory of the process but each", 0.93]],
      [["thread has its own stack and registers. Creating", 0.91]],
      [["a thread is faster than creating a process.", 0.95]],
    ],
  },
  "s1p1:Q2a": {
    continues: true,
    lines: [
      [["Q2. A deadlock is a situation where a set of", 0.95]],
      [["processes are blocked because each process is", 0.94]],
      [["holding a resource and waiting for another resource", 0.92]],
      [["held by some other process. The four conditions are", 0.93]],
      [["1) Mutual exclusion 2) Hold and wait", 0.9]],
    ],
  },
  "s1p2:Q2b": {
    lines: [
      [["(Q2 contd.) 3) No preemption 4) Circular wait.", 0.89]],
      [["All four must hold at the same time for a deadlock.", 0.93]],
    ],
  },
  "s1p2:Q3": {
    lines: [
      [["Q3. Virtual memory lets a process use more memory", 0.95]],
      [["than the physical RAM. Pages that are not needed", 0.93]],
      [["are kept on disk and loaded on demand, this is", 0.92]],
      [["called paging. It gives each process", 0.94], ["is?lat??n.", 0.31]],
    ],
  },
  "s1p3:Q4": {
    unsupported: "Diagram detected (Gantt chart) below the text. Diagrams are excluded from the baseline.",
    lines: [
      [["Q4. In preemptive scheduling the OS can stop a", 0.94]],
      [["running process and give the CPU to another one,", 0.93]],
      [["eg Round Robin. In non-preemptive scheduling the", 0.9]],
      [["process keeps the CPU until it finishes or blocks,", 0.92]],
      [["eg FCFS. See the Gantt chart below:", 0.88]],
      [["[non-text content: P1 | P2 | P3 | P1  0 4 10 13 18]", "unknown"]],
    ],
  },
  "s2p1:Q1": {
    lines: [
      [["Q1. Process is a running program. Thread is part", "unknown"]],
      [["of a process. Threads of the same process share", "unknown"]],
      [["the code and data, process does not share.", "unknown"]],
    ],
  },
  "s2p1:Q2": {
    lines: [
      [["Q2. Deadlock happens when two processes wait for", 0.92]],
      [["each other forever. Conditions are mutual exclusion,", 0.9]],
      [["hold and wait, no preemption and circular wait.", 0.93]],
    ],
  },
  "s2p2:Q3": { lines: [[["Q3.", 0.97]]] },
  "s2p2:Q4": {
    lines: [
      [["Q4. Preemptive means the CPU can be taken away", 0.94]],
      [["from a process. Non-preemptive means it cannot be", 0.88]],
      [["taken until the process is done.", 0.95]],
    ],
  },
};

type LayoutBlock = { key: string; top: number; height: number };
const LAYOUT = layout as Record<string, LayoutBlock[]>;

export function sampleBlocks(sampleKey: string): LayoutBlock[] {
  return LAYOUT[sampleKey] ?? [];
}

/** Returns the bundled OCR block that best overlaps the drawn region, or a generic result. */
export function mockOcr(sampleKey: string | undefined, bbox: Rect): OcrBlock & { key?: string } {
  if (sampleKey) {
    let best: { key: string; overlap: number } | null = null;
    for (const b of sampleBlocks(sampleKey)) {
      const overlap = Math.min(bbox.y + bbox.height, b.top + b.height) - Math.max(bbox.y, b.top);
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { key: b.key, overlap };
    }
    if (best) {
      const block = BLOCKS[`${sampleKey}:${best.key}`];
      if (block) return { ...block, key: best.key };
    }
    return { lines: [] }; // region with no handwriting -> blank
  }
  // Uploaded image: return realistic OCR lines based on vertical position on the page
  if (bbox.y < 32) {
    return {
      lines: [
        [["Q1. A process is an active program in execution with", 0.94]],
        [["an isolated virtual address space, whereas threads", 0.92]],
        [["share the process address space and resources.", 0.91]],
      ],
    };
  }
  if (bbox.y < 52) {
    return {
      lines: [
        [["Q2. Deadlock occurs when processes block permanently", 0.93]],
        [["waiting for resources held by one another: mutual", 0.91]],
        [["exclusion, hold and wait, no preemption, circular wait.", 0.89]],
      ],
    };
  }
  if (bbox.y < 72) {
    return {
      lines: [
        [["Q3. Virtual memory maps virtual pages to physical", 0.94]],
        [["frames via page tables and demand paging.", 0.92]],
      ],
    };
  }
  return {
    lines: [
      [["Q4. Preemptive scheduling allows the kernel to interrupt", 0.93]],
      [["a running task (e.g., Round Robin), while non-preemptive", 0.91]],
      [["scheduling runs until completion or I/O block (e.g., FCFS).", 0.92]],
    ],
  };
}

