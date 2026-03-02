import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import './ConfidenceChart.css';

const ConfidenceChart = ({ data }) => {
  const svgRef = useRef(null);

  useEffect(() => {
    if (!data?.length || !svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const margin = { top: 20, right: 20, bottom: 30, left: 40 };
    const width = svgRef.current.clientWidth - margin.left - margin.right;
    const height = 150 - margin.top - margin.bottom;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime()
      .domain(d3.extent(data, d => new Date(d.created_at)))
      .range([0, width]);

    const y = d3.scaleLinear()
      .domain([0, 100])
      .range([height, 0]);

    // Color zones
    g.append('rect').attr('x', 0).attr('y', y(100)).attr('width', width).attr('height', y(70) - y(100)).attr('fill', '#00ff9d08');
    g.append('rect').attr('x', 0).attr('y', y(70)).attr('width', width).attr('height', y(40) - y(70)).attr('fill', '#fdd83508');
    g.append('rect').attr('x', 0).attr('y', y(40)).attr('width', width).attr('height', y(0) - y(40)).attr('fill', '#ef535008');

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat(d3.timeFormat('%b %d')))
      .selectAll('text').attr('fill', '#666').style('font-size', '10px');
    g.append('g')
      .call(d3.axisLeft(y).ticks(5))
      .selectAll('text').attr('fill', '#666').style('font-size', '10px');
    g.selectAll('.domain, .tick line').attr('stroke', '#333');

    // Line
    const line = d3.line()
      .x(d => x(new Date(d.created_at)))
      .y(d => y(d.score))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#00ff9d')
      .attr('stroke-width', 2)
      .attr('d', line);

    // Dots
    g.selectAll('.dot')
      .data(data)
      .join('circle')
      .attr('cx', d => x(new Date(d.created_at)))
      .attr('cy', d => y(d.score))
      .attr('r', 4)
      .attr('fill', d => d.score >= 70 ? '#00ff9d' : d.score >= 40 ? '#fdd835' : '#ef5350')
      .attr('stroke', '#1a1a1a')
      .attr('stroke-width', 2);

    // Labels
    g.selectAll('.label')
      .data(data)
      .join('text')
      .attr('x', d => x(new Date(d.created_at)))
      .attr('y', d => y(d.score) - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', '#aaa')
      .style('font-size', '10px')
      .text(d => d.score);

  }, [data]);

  if (!data?.length) return null;

  return (
    <div className="confidence-chart">
      <h4>Confidence Over Time</h4>
      <svg ref={svgRef} width="100%" height="150" />
    </div>
  );
};

export default ConfidenceChart;
