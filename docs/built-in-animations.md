# 内置动画模版效果

* 根据 animationStyles.props 
* type.slide_in  direction.left distance 正数 渲染效果为从右往左

```json
[
  {
    "id": "225:47",
    "name": "Rectangle 17",
    "type": "RECTANGLE",
    "hasMotionData": true,
    "animationKeys": [
      "TRANSLATION_X",
      "TRANSLATION_Y"
    ],
    "animationStyles": [
      {
        "id": "AnimationPresetId:224:37",
        "styleId": "CodeComponentId:189:31",
        "name": "motion.preset_name.position",
        "duration": 0.5,
        "timelineOffset": 0,
        "props": {
          "delay": 0,
          "endY": 0,
          "endX": 0,
          "startY": 200,
          "axis": "xy",
          "startX": 200,
          "distance": 200,
          "direction": "left",
          "easing": {
            "type": "EASE_OUT",
            "easingFunctionCubicBezier": {
              "x1": 0,
              "y1": 0,
              "x2": 0.58,
              "y2": 1
            }
          },
          "type": "slide_in"
        }
      }
    ],
    "animations": {
      "TRANSLATION_X": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 831
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": -200
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      },
      "TRANSLATION_Y": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 1167
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      }
    },
    "timelines": [
      {
        "duration": 2
      }
    ]
  }
]
```

* type.slide_in  direction.left distance 负数时 渲染效果为从左往右

```json
  [
  {
    "id": "225:47",
    "name": "Rectangle 17",
    "type": "RECTANGLE",
    "hasMotionData": true,
    "animationKeys": [
      "TRANSLATION_X",
      "TRANSLATION_Y"
    ],
    "animationStyles": [
      {
        "id": "AnimationPresetId:224:37",
        "styleId": "CodeComponentId:189:31",
        "name": "motion.preset_name.position",
        "duration": 0.5,
        "timelineOffset": 0,
        "props": {
          "type": "slide_in",
          "easing": {
            "type": "EASE_OUT",
            "easingFunctionCubicBezier": {
              "x1": 0,
              "y1": 0,
              "x2": 0.58,
              "y2": 1
            }
          },
          "direction": "left",
          "distance": -200,
          "startX": 200,
          "axis": "xy",
          "startY": 200,
          "endX": 0,
          "endY": 0,
          "delay": 0
        }
      }
    ],
    "animations": {
      "TRANSLATION_X": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 831
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": 200
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      },
      "TRANSLATION_Y": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 1167
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      }
    },
    "timelines": [
      {
        "duration": 2
      }
    ]
  }
]
```


* type.slide_in  direction.right distance 正数时 渲染效果为从左往右

```json
[
  {
    "id": "225:47",
    "name": "Rectangle 17",
    "type": "RECTANGLE",
    "hasMotionData": true,
    "animationKeys": [
      "TRANSLATION_X",
      "TRANSLATION_Y"
    ],
    "animationStyles": [
      {
        "id": "AnimationPresetId:224:37",
        "styleId": "CodeComponentId:189:31",
        "name": "motion.preset_name.position",
        "duration": 0.5,
        "timelineOffset": 0,
        "props": {
          "type": "slide_in",
          "easing": {
            "type": "EASE_OUT",
            "easingFunctionCubicBezier": {
              "x1": 0,
              "y1": 0,
              "x2": 0.58,
              "y2": 1
            }
          },
          "direction": "right",
          "distance": 200,
          "startX": 200,
          "axis": "xy",
          "startY": 200,
          "endX": 0,
          "endY": 0,
          "delay": 0
        }
      }
    ],
    "animations": {
      "TRANSLATION_X": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 831
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": 200
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      },
      "TRANSLATION_Y": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 1167
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      }
    },
    "timelines": [
      {
        "duration": 2
      }
    ]
  }
]
```

* type.slide_in  direction.right distance 负数时 渲染效果为从右往左
```json
[
  {
    "id": "225:47",
    "name": "Rectangle 17",
    "type": "RECTANGLE",
    "hasMotionData": true,
    "animationKeys": [
      "TRANSLATION_X",
      "TRANSLATION_Y"
    ],
    "animationStyles": [
      {
        "id": "AnimationPresetId:224:37",
        "styleId": "CodeComponentId:189:31",
        "name": "motion.preset_name.position",
        "duration": 0.5,
        "timelineOffset": 0,
        "props": {
          "type": "slide_in",
          "easing": {
            "type": "EASE_OUT",
            "easingFunctionCubicBezier": {
              "x1": 0,
              "y1": 0,
              "x2": 0.58,
              "y2": 1
            }
          },
          "direction": "right",
          "distance": -200,
          "startX": 200,
          "axis": "xy",
          "startY": 200,
          "endX": 0,
          "endY": 0,
          "delay": 0
        }
      }
    ],
    "animations": {
      "TRANSLATION_X": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 831
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": -200
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      },
      "TRANSLATION_Y": {
        "timelineDuration": 2,
        "baseValue": {
          "type": "FLOAT",
          "value": 1167
        },
        "tracks": [
          {
            "keyframeOperation": "OFFSET",
            "keyframes": [
              {
                "timelinePosition": 0,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              },
              {
                "timelinePosition": 0.5,
                "value": {
                  "type": "FLOAT",
                  "value": 0
                },
                "easing": {
                  "type": "CUSTOM_CUBIC_BEZIER",
                  "easingFunctionCubicBezier": {
                    "x1": 0,
                    "y1": 0,
                    "x2": 0.58,
                    "y2": 1
                  }
                }
              }
            ]
          }
        ]
      }
    },
    "timelines": [
      {
        "duration": 2
      }
    ]
  }
]
```

* 根据上面动画数据以及实际的渲染效果可以观察到像是下面的结论

type.slide_in  direction.left 就是从 (原始位置 + distance) 到 原始位置
type.slide_in  direction.right 就是从 (原始位置 - distance) 到 原始位置

然后还有一点在普通编辑模式下 "Rectangle 17"
Position x: 49 y: 159 
Layout w: 340 h: 304

而在motion 模式下 "Rectangle 17"
Transform Position 显示 x: 661 y: 1015 
Layout w: 340 h: 304

进一步发现 
TRANSLATION_X.baseValue = (661 + 340 * 0.5) = 831
TRANSLATION_Y.baseValue = (1015 + 304 * 0.5) = 1167