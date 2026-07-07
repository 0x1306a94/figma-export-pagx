//
//  OpenGLRenderView.h
//  PAGXAnimationViewer
//

#import <Cocoa/Cocoa.h>

NS_ASSUME_NONNULL_BEGIN

@class OpenGLRenderView;

@protocol OpenGLRenderViewDelegate <NSObject>
- (void)openGLRenderView:(OpenGLRenderView *)view drawWithPixelSize:(NSSize)pixelSize;
@optional
- (void)openGLRenderViewDidResize:(OpenGLRenderView *)view;
- (void)openGLRenderView:(OpenGLRenderView *)view didAcceptPagxFileAtPath:(NSString *)filePath;
@end

@interface OpenGLRenderView : NSOpenGLView

@property (nonatomic, weak, nullable) id<OpenGLRenderViewDelegate> delegate;

- (void)makeCurrentContext;
- (NSSize)backingPixelSize;

@end

NS_ASSUME_NONNULL_END
