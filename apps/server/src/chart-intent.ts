export type ChartType = "bar" | "line" | "pie" | "donut";

const chartTypeTerms: Record<ChartType, string[]> = {
  bar: ["柱状图", "柱形图", "条形图", "bar chart", "column chart"],
  line: ["折线图", "线状图", "曲线图", "line chart"],
  pie: ["饼图", "饼状图", "pie chart"],
  donut: [
    "环状图",
    "环形图",
    "圆环图",
    "甜甜圈图",
    "donut chart",
    "doughnut chart",
    "ring chart",
  ],
};

export function requestedChartType(message: string): ChartType | undefined {
  const normalized = message.toLocaleLowerCase();
  let selected: { type: ChartType; index: number } | undefined;
  for (const [type, terms] of Object.entries(chartTypeTerms) as Array<
    [ChartType, string[]]
  >) {
    for (const term of terms) {
      const index = normalized.lastIndexOf(term);
      if (index >= 0 && (!selected || index > selected.index))
        selected = { type, index };
    }
  }
  return selected?.type;
}
