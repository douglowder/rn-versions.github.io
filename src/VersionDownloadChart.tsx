import React from "react";

import generateColor, { AvoidToken } from "./generateColor";
import styles from "./VersionDownloadChart.styles";
import { createTooltipContent } from "./VersionTooltip";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { HistoryPoint } from "./HistoryReader";
import { ITheme } from "@fluentui/react";

export type MeasurementTransform = "totalDownloads" | "percentage";

export type VersionLabeler = (version: string) => string;

export type VersionDownloadChartProps = {
  /**
   * Points to render
   */
  historyPoints: HistoryPoint[];

  /**
   * Maximum duration the graph will show, in days
   */
  maxDaysShown?: number;

  /**
   * Maximum total ticks to show for dates/times
   */
  maxTicks?: number;

  /**
   * Maximum separate versions show, attempting to show most popular versions.
   */
  maxVersionsShown?: number;

  /**
   * Whether to show the legend (defaults to true)
   */
  showLegend?: boolean;

  /**
   * Whether to show the tooltip (defaults to true)
   */
  showTooltip?: boolean;

  /**
   * Allows transforming raw measurements to a different unit
   */
  measurementTransform?: MeasurementTransform;

  /**
   * Allows relabeling versions
   */
  versionLabeler?: VersionLabeler;

  /**
   * Override the default provided theme for the tooltip
   */
  tooltipTheme?: ITheme;
};

const VersionDownloadChart: React.FC<VersionDownloadChartProps> = ({
  historyPoints,
  maxDaysShown,
  maxVersionsShown,
  maxTicks,
  showLegend,
  showTooltip,
  measurementTransform,
  versionLabeler,
  tooltipTheme,
}) => {
  maxDaysShown = maxDaysShown ?? 30;
  const topRawDataPoints = maxVersionsShown
    ? filterTopN(historyPoints, maxVersionsShown, maxDaysShown)
    : historyPoints;

  const datapoints =
    measurementTransform === "percentage"
      ? transformToPercentage(topRawDataPoints)
      : topRawDataPoints;

  const dateTimeFormat = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  });

  const allVersionsSet = new Set(datapoints.map((p) => p.version));
  const allVersionsArr = [...allVersionsSet];

  let latAvoidToken: AvoidToken | undefined = undefined;
  const chartAreas = allVersionsArr.map((v, i) => {
    const { color, avoidToken } = generateColor(v, latAvoidToken);
    latAvoidToken = avoidToken;

    return (
      <Area
        {...styles.area}
        name={versionLabeler ? versionLabeler(v) : v}
        key={v}
        dataKey={(datapoint) => datapoint.versionCounts[v]}
        stackId="1"
        stroke={color}
        fill={color}
      />
    );
  });

  const data: Array<{ date: number; versionCounts: Record<string, number> }> =
    [];
  for (const version of allVersionsArr) {
    for (const measurePoint of datapoints) {
      if (measurePoint.version === version) {
        const datePoint = data.find((p) => p.date === measurePoint.date);
        if (datePoint) {
          datePoint.versionCounts[version] = measurePoint.count;
        } else {
          data.push({
            date: measurePoint.date,
            versionCounts: { [version]: measurePoint.count },
          });
        }
      }
    }
  }

  if (datapoints.length === 0) {
    return (
      <div
        style={{
          height: styles.responsiveContainer.height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
        }}
      ></div>
    );
  }

  return (
    <ResponsiveContainer {...styles.responsiveContainer}>
      <AreaChart data={data}>
        <XAxis
          {...styles.xAxis}
          dataKey="date"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={(unixTime) =>
            dateTimeFormat.format(new Date(unixTime))
          }
          interval={0}
          ticks={calculateDateTicks(
            datapoints.map((p) => p.date),
            maxTicks ?? 6
          )}
        />
        <YAxis
          {...styles.yAxis}
          type="number"
          {...(measurementTransform === "percentage"
            ? {
                domain: [0, 1],
                tickFormatter: (count) => `${Math.round(count * 100)}%`,
              }
            : {
                domain: ["auto", "auto"],
                tickFormatter: (count) => count.toLocaleString(),
              })}
        />
        <CartesianGrid {...styles.grid} />

        {showTooltip !== false && (
          <Tooltip
            content={createTooltipContent({
              measurementTransform,
              theme: tooltipTheme,
            })}
          />
        )}
        {showLegend !== false && <Legend {...styles.legend} />}

        {chartAreas}
      </AreaChart>
    </ResponsiveContainer>
  );
};

function calculateDateTicks(dates: number[], maxTicks: number): number[] {
  const first = dates[0];
  const last = dates[dates.length - 1];

  if (maxTicks === 0) {
    return [];
  }

  if (maxTicks === 1) {
    return [first];
  }

  if (maxTicks === 2) {
    return [first, last];
  }

  const dataDuration = last - first;
  const dayDuration = 24 * 60 * 60 * 1000;
  const weekDuration = 7 * dayDuration;

  const maxInteriorTicks = maxTicks - 1;
  let tickInterval = weekDuration;
  while (Math.floor(dataDuration / tickInterval) > maxInteriorTicks) {
    tickInterval *= 2;
  }

  const ticks = new Set([first]);
  let nextTick = fromDayStart(first, tickInterval);

  for (const date of dates) {
    if (date >= nextTick) {
      ticks.add(date);
      nextTick = fromDayStart(date, tickInterval);
    }
  }

  console.log(ticks);
  return [...ticks];
}

function fromDayStart(date: number, duration: number): number {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  return dayStart.getTime() + duration;
}

function transformToPercentage(points: HistoryPoint[]): HistoryPoint[] {
  const totalCountByDate: Record<number, number | undefined> = {};

  for (const point of points) {
    const prevTotal = totalCountByDate[point.date] ?? 0;
    totalCountByDate[point.date] = prevTotal + point.count;
  }

  return points.map((point) => ({
    ...point,
    count: point.count / totalCountByDate[point.date]!,
  }));
}

function filterTopN(
  historyPoints: HistoryPoint[],
  n: number,
  windowInDays: number
): HistoryPoint[] {
  if (historyPoints.length === 0) {
    return [];
  }

  const latestDate = historyPoints[historyPoints.length - 1].date;
  const latestDay = new Date(latestDate).setHours(0, 0, 0, 0);

  const earliestAllowableDate = latestDay - windowInDays * 24 * 60 * 60 * 1000;
  const versionsInWindow: Array<{ version: string; count: number }> = [];

  for (const point of historyPoints) {
    if (point.date >= earliestAllowableDate) {
      const existingCount = versionsInWindow.find(
        (v) => v.version === point.version
      );
      const newCount = point.date < earliestAllowableDate ? 0 : point.count;

      if (existingCount) {
        existingCount.count += newCount;
      } else {
        versionsInWindow.push({ version: point.version, count: newCount });
      }
    }
  }

  const topVersions = versionsInWindow
    .sort((a, b) => a.count - b.count)
    .slice(-n)
    .map((v) => v.version);

  const topVersionsInOrder: string[] = [];
  for (const point of historyPoints) {
    if (
      topVersions.includes(point.version) &&
      !topVersionsInOrder.includes(point.version)
    ) {
      topVersionsInOrder.push(point.version);
    }
  }

  const filteredPoints: HistoryPoint[] = [];
  for (const point of historyPoints) {
    if (topVersions.includes(point.version)) {
      filteredPoints.push(point);
    }
  }

  const pointsByDate: Map<
    number,
    { version: string; count: number }[] | undefined
  > = new Map();
  for (const point of filteredPoints) {
    const last = pointsByDate.get(point.date) ?? [];
    pointsByDate.set(point.date, [...last, point]);
  }

  const datesAscending = [...pointsByDate.keys()].sort();
  const pointsWithZero: HistoryPoint[] = [];

  for (const date of datesAscending) {
    if (date < earliestAllowableDate) {
      continue;
    }

    for (const topVersion of topVersionsInOrder) {
      const existingPoint = pointsByDate
        .get(date)!
        .find((p) => p.version === topVersion);
      if (existingPoint) {
        pointsWithZero.push({ date, ...existingPoint });
      } else {
        pointsWithZero.push({ date, version: topVersion, count: 0 });
      }
    }
  }

  return pointsWithZero;
}

export default VersionDownloadChart;
