//
//  OpenGLRenderView.m
//  PAGXAnimationViewer
//
//  Created by king on 2026/7/7.
//

#import "OpenGLRenderView.h"

@implementation OpenGLRenderView

+ (NSOpenGLPixelFormat *)defaultPixelFormat {
    NSOpenGLPixelFormatAttribute attributes[] = {
        NSOpenGLPFAOpenGLProfile,
        NSOpenGLProfileVersion3_2Core,
        NSOpenGLPFADoubleBuffer,
        NSOpenGLPFAColorSize,
        24,
        NSOpenGLPFAAlphaSize,
        8,
        NSOpenGLPFADepthSize,
        24,
        NSOpenGLPFAStencilSize,
        8,
        0,
    };
    return [[NSOpenGLPixelFormat alloc] initWithAttributes:attributes];
}

- (instancetype)initWithFrame:(NSRect)frameRect {
    self = [super initWithFrame:frameRect pixelFormat:[OpenGLRenderView defaultPixelFormat]];
    if (self) {
        self.wantsBestResolutionOpenGLSurface = YES;
        [self registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
    }
    return self;
}

- (nullable NSString *)pagxFilePathFromDraggingInfo:(id<NSDraggingInfo>)draggingInfo {
    NSPasteboard *pasteboard = draggingInfo.draggingPasteboard;
    if (![pasteboard.types containsObject:NSPasteboardTypeFileURL]) {
        return nil;
    }

    NSArray<NSURL *> *fileURLs =
        [pasteboard readObjectsForClasses:@[[NSURL class]] options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}];
    for (NSURL *fileURL in fileURLs) {
        if (fileURL.isFileURL && [fileURL.pathExtension.lowercaseString isEqualToString:@"pagx"]) {
            return fileURL.path;
        }
    }
    return nil;
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    return [self pagxFilePathFromDraggingInfo:sender] != nil ? NSDragOperationCopy : NSDragOperationNone;
}

- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
    return [self draggingEntered:sender];
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSString *filePath = [self pagxFilePathFromDraggingInfo:sender];
    if (filePath == nil) {
        return NO;
    }

    id<OpenGLRenderViewDelegate> renderDelegate = self.delegate;
    if ([renderDelegate respondsToSelector:@selector(openGLRenderView:didAcceptPagxFileAtPath:)]) {
        [renderDelegate openGLRenderView:self didAcceptPagxFileAtPath:filePath];
    }
    return YES;
}

- (void)prepareOpenGL {
    [super prepareOpenGL];
    [self makeCurrentContext];

    GLint swapInterval = 1;
    [[self openGLContext] setValues:&swapInterval forParameter:NSOpenGLContextParameterSwapInterval];
}

- (void)viewDidMoveToWindow {
    [super viewDidMoveToWindow];
    if (self.window == nil) {
        return;
    }
    [[self openGLContext] update];
    [self setNeedsDisplay:YES];
}

- (void)reshape {
    [super reshape];
    [[self openGLContext] update];
    id<OpenGLRenderViewDelegate> renderDelegate = self.delegate;
    if ([renderDelegate respondsToSelector:@selector(openGLRenderViewDidResize:)]) {
        [renderDelegate openGLRenderViewDidResize:self];
    }
    [self setNeedsDisplay:YES];
}

- (void)makeCurrentContext {
    [[self openGLContext] makeCurrentContext];
}

- (NSSize)backingPixelSize {
    return [self convertSizeToBacking:self.bounds.size];
}

- (void)drawRect:(NSRect)dirtyRect {
    [[self openGLContext] update];
    [self makeCurrentContext];

    id<OpenGLRenderViewDelegate> renderDelegate = self.delegate;
    if (renderDelegate != nil) {
        NSSize pixelSize = [self backingPixelSize];
        [renderDelegate openGLRenderView:self drawWithPixelSize:pixelSize];
    }

    // PAGScene::draw unlocks the GL device and clears the current context.
    [self makeCurrentContext];
    [[self openGLContext] flushBuffer];
}

@end
