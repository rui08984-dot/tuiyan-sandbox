/**
 * 图表原语出口（2026-09-22 全方面重构）
 * 自研 inline SVG + CSS，零 npm 依赖（守「不新增依赖／不引 UI 库」铁律）。
 */
export { ChartFrame, LegendItem } from './ChartFrame';
export { Gauge, BrierGauge } from './Gauge';
export { ErrorBar, ForestPlot } from './ErrorBar';
export { HeatGrid } from './HeatGrid';
export type { HeatCell } from './HeatGrid';
export { Bar, StackedBar, NestedBar } from './Bars';
export { LineChart, Histogram } from './LineChart';
export type { Series } from './LineChart';
export { FilterChips, ChipFilter, SparkBar, ReliabilityPlot } from './Controls';
export { ReadoutCard, MiniGauge, MiniTrend } from './ReadoutCard';
export * as scale from './scale';
export { BRIER_NOINFO } from './scale';
