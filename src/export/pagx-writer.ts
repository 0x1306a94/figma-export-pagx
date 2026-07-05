import type {
  ColorSource,
  PagxDocument,
  PagxElement,
  PagxLayer,
  PagxResource,
} from './types';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatAttrValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return escapeXml(String(value));
}

function writeAttrs(attrs: Record<string, string | number | boolean>): string {
  return Object.entries(attrs)
    .filter(([key, value]) => {
      if (value === undefined || value === null || value === '') {
        return false;
      }
      if ((key === 'left' || key === 'top') && value === 0) {
        return false;
      }
      return true;
    })
    .map(([key, value]) => ` ${key}="${formatAttrValue(value)}"`)
    .join('');
}

function writeCustomData(customData: Record<string, string>): string {
  return Object.entries(customData)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('');
}

function writeColorSource(colorSource: ColorSource, indent: string): string {
  switch (colorSource.kind) {
    case 'solid':
      return `${indent}<SolidColor color="${escapeXml(colorSource.color)}"/>\n`;
    case 'linearGradient': {
      let attrs = '';
      if (colorSource.startPoint) attrs += ` startPoint="${colorSource.startPoint}"`;
      if (colorSource.endPoint) attrs += ` endPoint="${colorSource.endPoint}"`;
      const stops = colorSource.stops
        .map((stop) => `${indent}  <ColorStop offset="${stop.offset}" color="${escapeXml(stop.color)}"/>\n`)
        .join('');
      return `${indent}<LinearGradient${attrs}>\n${stops}${indent}</LinearGradient>\n`;
    }
    case 'radialGradient': {
      let attrs = '';
      if (colorSource.center) attrs += ` center="${colorSource.center}"`;
      if (colorSource.radius !== undefined) attrs += ` radius="${colorSource.radius}"`;
      const stops = colorSource.stops
        .map((stop) => `${indent}  <ColorStop offset="${stop.offset}" color="${escapeXml(stop.color)}"/>\n`)
        .join('');
      return `${indent}<RadialGradient${attrs}>\n${stops}${indent}</RadialGradient>\n`;
    }
    case 'conicGradient': {
      let attrs = '';
      if (colorSource.center) attrs += ` center="${colorSource.center}"`;
      if (colorSource.startAngle !== undefined) attrs += ` startAngle="${colorSource.startAngle}"`;
      if (colorSource.endAngle !== undefined) attrs += ` endAngle="${colorSource.endAngle}"`;
      const stops = colorSource.stops
        .map((stop) => `${indent}  <ColorStop offset="${stop.offset}" color="${escapeXml(stop.color)}"/>\n`)
        .join('');
      return `${indent}<ConicGradient${attrs}>\n${stops}${indent}</ConicGradient>\n`;
    }
    case 'diamondGradient': {
      let attrs = '';
      if (colorSource.center) attrs += ` center="${colorSource.center}"`;
      if (colorSource.radius !== undefined) attrs += ` radius="${colorSource.radius}"`;
      const stops = colorSource.stops
        .map((stop) => `${indent}  <ColorStop offset="${stop.offset}" color="${escapeXml(stop.color)}"/>\n`)
        .join('');
      return `${indent}<DiamondGradient${attrs}>\n${stops}${indent}</DiamondGradient>\n`;
    }
    case 'imagePattern': {
      let attrs = ` image="${escapeXml(colorSource.imageRef)}"`;
      if (colorSource.scaleMode) attrs += ` scaleMode="${colorSource.scaleMode}"`;
      return `${indent}<ImagePattern${attrs}/>\n`;
    }
    default:
      return '';
  }
}

function writeElement(element: PagxElement, indent: string): string {
  switch (element.kind) {
    case 'rectangle':
      return `${indent}<Rectangle${writeAttrs(element.attrs)}/>\n`;
    case 'ellipse':
      return `${indent}<Ellipse${writeAttrs(element.attrs)}/>\n`;
    case 'polystar':
      return `${indent}<Polystar${writeAttrs(element.attrs)}/>\n`;
    case 'path': {
      if (!element.attrs.data) {
        return '';
      }
      return `${indent}<Path${writeAttrs(element.attrs)}/>\n`;
    }
    case 'text': {
      const attrEntries = { ...element.attrs };
      delete attrEntries.text;
      return `${indent}<Text${writeAttrs(attrEntries)}><![CDATA[${element.text}]]></Text>\n`;
    }
    case 'textbox': {
      let result = `${indent}<TextBox${writeAttrs(element.attrs)}>\n`;
      for (const child of element.children) {
        result += writeElement(child, `${indent}  `);
      }
      result += `${indent}</TextBox>\n`;
      return result;
    }
    case 'fill': {
      if (element.colorSource) {
        return `${indent}<Fill>\n${writeColorSource(element.colorSource, `${indent}  `)}${indent}</Fill>\n`;
      }
      return `${indent}<Fill${writeAttrs(element.attrs)}/>\n`;
    }
    case 'stroke': {
      if (element.colorSource) {
        return `${indent}<Stroke${writeAttrs(element.attrs)}>\n${writeColorSource(element.colorSource, `${indent}  `)}${indent}</Stroke>\n`;
      }
      return `${indent}<Stroke${writeAttrs(element.attrs)}/>\n`;
    }
    case 'dropShadowStyle':
      return `${indent}<DropShadowStyle${writeAttrs(element.attrs)}/>\n`;
    case 'innerShadowStyle':
      return `${indent}<InnerShadowStyle${writeAttrs(element.attrs)}/>\n`;
    case 'backgroundBlurStyle':
      return `${indent}<BackgroundBlurStyle${writeAttrs(element.attrs)}/>\n`;
    case 'blurFilter':
      return `${indent}<BlurFilter${writeAttrs(element.attrs)}/>\n`;
    default:
      return '';
  }
}

function writeLayer(layer: PagxLayer, indent: string): string {
  const attrs = { name: layer.name, id: layer.id, ...layer.attrs };
  let result = `${indent}<Layer${writeAttrs(attrs)}${writeCustomData(layer.customData)}>\n`;

  for (const content of layer.contents) {
    result += writeElement(content, `${indent}  `);
  }

  for (const child of layer.children) {
    result += writeLayer(child, `${indent}  `);
  }

  result += `${indent}</Layer>\n`;
  return result;
}

function writeResource(resource: PagxResource, indent: string): string {
  if (resource.kind === 'image') {
    return `${indent}<Image id="${escapeXml(resource.id)}" source="${escapeXml(resource.source)}"/>\n`;
  }
  return '';
}

export function writePagxXml(document: PagxDocument): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += `<pagx width="${document.width}" height="${document.height}"${writeCustomData(document.customData)}>\n`;

  if (document.resources.length > 0) {
    xml += '  <Resources>\n';
    for (const resource of document.resources) {
      xml += writeResource(resource, '    ');
    }
    xml += '  </Resources>\n';
  }

  for (const layer of document.layers) {
    xml += writeLayer(layer, '  ');
  }

  xml += '</pagx>\n';
  return xml;
}
