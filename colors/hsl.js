// Helper: Validate and parse HSL input
function parseHsl(input) {
    if (typeof input !== 'string') return null;
    
    // Remove whitespace and convert to lowercase
    const cleaned = input.trim().toLowerCase();
    
    // Match various HSL formats
    const hslMatch = cleaned.match(/^hsl\s*\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)$/);
    const spaceSeparated = cleaned.match(/^(\d+)\s+(\d+)%?\s+(\d+)%?$/);
    const commaSeparated = cleaned.match(/^(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?$/);
    
    let h, s, l;
    
    if (hslMatch) {
      [, h, s, l] = hslMatch.map(Number);
    } else if (spaceSeparated) {
      [, h, s, l] = spaceSeparated.map(Number);
    } else if (commaSeparated) {
      [, h, s, l] = commaSeparated.map(Number);
    } else {
      return null;
    }
    
    // Validate HSL values
    if (h < 0 || h > 360 || s < 0 || s > 100 || l < 0 || l > 100) {
      return null;
    }
    
    return { h, s, l };
  }
  
  // Helper: Convert HSL to RGB
  function hslToRgb({ h, s, l }) {
    h /= 360;
    s /= 100;
    l /= 100;
    
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    
    let r, g, b;
    
    if (s === 0) {
      r = g = b = l; // achromatic
    } else {
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    
    return {
      r: Math.round(r * 255),
      g: Math.round(g * 255),
      b: Math.round(b * 255)
    };
  }
  
  // Helper: Convert RGB to hex
  function rgbToHex({ r, g, b }) {
    const toHex = (n) => {
      const hex = Math.round(n).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };
    return toHex(r) + toHex(g) + toHex(b);
  }
  
  // Helper: Get color name/description
  function getColorInfo(hex, hsl) {
    const { h, s, l } = hsl;
    
    // Exact match for white and black
    if (hex.toLowerCase() === 'ffffff') return 'White';
    if (hex.toLowerCase() === '000000') return 'Black';
  
    let description = '';
    
    // Lightness description
    if (l < 20) description += 'Very Dark ';
    else if (l < 40) description += 'Dark ';
    else if (l > 80) description += 'Light ';
    else if (l > 60) description += 'Bright ';
    
    // Saturation description
    if (s < 10) description += 'Gray';
    else if (s < 30) description += 'Muted ';
    
    // Hue description
    if (s >= 10) {
      if (h >= 0 && h < 15) description += 'Red';
      else if (h >= 15 && h < 45) description += 'Orange';
      else if (h >= 45 && h < 75) description += 'Yellow';
      else if (h >= 75 && h < 150) description += 'Green';
      else if (h >= 150 && h < 210) description += 'Cyan';
      else if (h >= 210 && h < 270) description += 'Blue';
      else if (h >= 270 && h < 330) description += 'Purple';
      else description += 'Red';
    }
    
    return description.trim() || 'Neutral';
  }
  
  const run = async (query) => {
    try {
      const hsl = parseHsl(query);
      if (!hsl) {
        return [];
      }
  
      const rgb = hslToRgb(hsl);
      const hex = rgbToHex(rgb);
      const hexString = `#${hex}`;
      const rgbString = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
      const hslString = `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
      const colorInfo = getColorInfo(hex, hsl);
  
      return [
        {
          data: {
            id: hslString,
            hex: hexString,
            rgb: rgbString,
            hsl: hslString,
          },
          content: [
            {
              type: 'div',
              className: 'flex gap-6 p-4',
              children: [
                // Left side - Color values list
                {
                  type: 'div',
                  className: 'flex flex-col gap-2 min-w-48',
                  children: [
                    { 
                      type: 'p', 
                      content: `HSL: ${hslString}`, 
                      className: 'px-3 py-2 rounded' 
                    },
                    { 
                      type: 'p', 
                      content: `RGB: ${rgbString}`, 
                      className: 'px-3 py-2 rounded' 
                    },
                    { 
                      type: 'p', 
                      content: `HEX: ${hexString}`, 
                      className: 'px-3 py-2 rounded' 
                    }
                  ]
                },
                // Right side - Color display and info
                {
                    type: 'div',
                    className: 'flex flex-col items-center gap-4 flex-1',
                    props: {
                      style: {
                        borderLeft: "1px solid #333"
                      }
                    },
                    children: [
                      // Color circle
                      {
                        type: 'div',
                        className: 'w-12 h-12 min-w-12 min-h-12 p-6',
                        props: {
                          style: { 
                            backgroundColor: `${hexString}`,
                            border: `6px solid rgb(${
                              Math.max(0, Math.floor(rgb.r * 0.8))
                            },${
                              Math.max(0, Math.floor(rgb.g * 0.8))
                            },${
                              Math.max(0, Math.floor(rgb.b * 0.8))
                            })`,
                            borderRadius: "9999px",
                          }
                        }
                      },
                      // Color information
                      {
                        type: 'div',
                        className: 'flex flex-col text-start w-full',
                        children: [
                          { 
                            type: 'span', 
                            content: colorInfo, 
                            className: 'text-lg font-medium mb-2',
                            props: {
                              style: {
                                borderTop: "1px solid #333",
                                borderBottom: "1px solid #333",
                                padding: "2px 80px 2px 40px"
                              }
                            },
                          },
                          { 
                            type: 'span', 
                            content: `Lightness: ${hsl.l}%`, 
                            className: 'text-sm text-zinc-600',
                            props: {
                              style: {
                                padding: "6px 0 0 40px"
                              }
                            },
                          },
                          { 
                            type: 'span', 
                            content: ` Saturation: ${hsl.s}%`, 
                            className: 'text-sm text-zinc-600',
                            props: {
                              style: {
                                padding: "0 0 0 40px"
                              }
                            },
                          }
                        ]
                      }
                    ]
                  }
              ]
            }
          ]
        }
      ];
    } catch (error) {
      console.log(error);
      return [];
    }
  };
  
  const copyHex = async (data, { clipboard }) => {
    clipboard.writeText(data.hex);
  };
  
  const copyRgb = async (data, { clipboard }) => {
    clipboard.writeText(data.rgb);
  };
  
  module.exports = {
    run,
    actions: [
      { name: 'Copy HEX', action: copyHex },
      { name: 'Copy RGB', action: copyRgb }
    ]
  };