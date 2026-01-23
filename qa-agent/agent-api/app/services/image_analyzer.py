"""Image analysis service for extracting UI elements and patterns from uploaded images."""

import logging
import json
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


class ImageAnalyzer:
    """Service for analyzing uploaded images to extract UI information."""
    
    def __init__(self):
        """Initialize image analyzer."""
        pass
    
    async def analyze_image(
        self,
        image_path: Path,
        run_id: str,
        artifacts_path: str
    ) -> Dict[str, Any]:
        """
        Analyze an uploaded image to extract UI elements, components, and patterns.
        
        Args:
            image_path: Path to the uploaded image file
            run_id: Run identifier
            artifacts_path: Path to artifacts directory
        
        Returns:
            Dict with extracted information
        """
        try:
            logger.info(f"[{run_id}] Analyzing image: {image_path.name}")
            
            # Basic image metadata
            image_info = {
                "filename": image_path.name,
                "file_path": str(image_path),
                "file_size": image_path.stat().st_size,
                "analyzed_at": datetime.utcnow().isoformat() + "Z",
                "run_id": run_id
            }
            
            # Try to extract image dimensions using PIL if available
            try:
                from PIL import Image
                with Image.open(image_path) as img:
                    image_info["width"] = img.width
                    image_info["height"] = img.height
                    image_info["format"] = img.format
                    image_info["mode"] = img.mode
            except ImportError:
                logger.warning(f"[{run_id}] PIL/Pillow not installed, skipping image dimensions")
            except Exception as e:
                logger.debug(f"[{run_id}] Could not read image dimensions: {e}")
            
            # Extract UI elements and patterns
            analysis_result = {
                "image_info": image_info,
                "ui_elements": await self._extract_ui_elements(image_path, run_id),
                "text_content": await self._extract_text_content(image_path, run_id),
                "color_scheme": await self._extract_color_scheme(image_path, run_id),
                "layout_structure": await self._extract_layout_structure(image_path, run_id),
                "components_detected": await self._detect_components(image_path, run_id),
                "workflow_hints": await self._identify_workflow_hints(image_path, run_id),
                "accessibility_notes": await self._check_accessibility(image_path, run_id)
            }
            
            # Save analysis results
            analysis_file = Path(artifacts_path) / "uploads" / "images" / f"{image_path.stem}_analysis.json"
            analysis_file.parent.mkdir(parents=True, exist_ok=True)
            with open(analysis_file, "w") as f:
                json.dump(analysis_result, f, indent=2, default=str)
            
            logger.info(f"[{run_id}] Image analysis completed: {image_path.name}")
            return analysis_result
        
        except Exception as e:
            logger.error(f"[{run_id}] Failed to analyze image {image_path.name}: {e}", exc_info=True)
            return {
                "image_info": {"filename": image_path.name, "error": str(e)},
                "ui_elements": [],
                "text_content": [],
                "color_scheme": {},
                "layout_structure": {},
                "components_detected": [],
                "workflow_hints": [],
                "accessibility_notes": []
            }
    
    async def _extract_ui_elements(
        self,
        image_path: Path,
        run_id: str
    ) -> List[Dict[str, Any]]:
        """Extract UI elements from image (buttons, inputs, cards, etc.)."""
        elements = []
        
        try:
            # Try using OCR to detect text-based elements
            try:
                import pytesseract
                from PIL import Image
                
                with Image.open(image_path) as img:
                    # Get text with bounding boxes
                    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
                    
                    current_element = None
                    for i, text in enumerate(data['text']):
                        if text.strip():
                            x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                            
                            # Detect element type based on text patterns
                            element_type = self._classify_element_type(text, w, h)
                            
                            elements.append({
                                "type": element_type,
                                "text": text.strip(),
                                "position": {"x": x, "y": y, "width": w, "height": h},
                                "confidence": data.get('conf', [0])[i] if isinstance(data.get('conf'), list) else 0
                            })
            except ImportError:
                logger.debug(f"[{run_id}] pytesseract not available, using basic analysis")
            except Exception as e:
                logger.debug(f"[{run_id}] OCR extraction failed: {e}")
            
            # If no elements found, add placeholder
            if not elements:
                elements.append({
                    "type": "unknown",
                    "text": "Image analysis pending - install pytesseract for OCR",
                    "position": {"x": 0, "y": 0, "width": 0, "height": 0},
                    "note": "Install pytesseract and Pillow for text extraction"
                })
        
        except Exception as e:
            logger.debug(f"[{run_id}] UI element extraction error: {e}")
        
        return elements
    
    def _classify_element_type(self, text: str, width: int, height: int) -> str:
        """Classify UI element type based on text and dimensions."""
        text_lower = text.lower()
        
        # Button indicators
        if any(keyword in text_lower for keyword in ['submit', 'save', 'cancel', 'delete', 'create', 'add', 'edit', 'update']):
            return "button"
        
        # Input field indicators
        if any(keyword in text_lower for keyword in ['enter', 'input', 'search', 'email', 'password', 'username']):
            return "input"
        
        # Link indicators
        if text.startswith('http') or text.startswith('www.') or 'link' in text_lower:
            return "link"
        
        # Card/tile indicators (based on size)
        if width > 200 and height > 150:
            return "card"
        
        # Label indicators
        if ':' in text or len(text) < 30:
            return "label"
        
        return "text"
    
    async def _extract_text_content(
        self,
        image_path: Path,
        run_id: str
    ) -> List[Dict[str, Any]]:
        """Extract all text content from image."""
        text_items = []
        
        try:
            import pytesseract
            from PIL import Image
            
            with Image.open(image_path) as img:
                # Simple text extraction
                text = pytesseract.image_to_string(img)
                
                if text.strip():
                    lines = [line.strip() for line in text.split('\n') if line.strip()]
                    for line in lines:
                        text_items.append({
                            "text": line,
                            "type": "paragraph" if len(line) > 50 else "label"
                        })
        except ImportError:
            logger.debug(f"[{run_id}] pytesseract not available for text extraction")
        except Exception as e:
            logger.debug(f"[{run_id}] Text extraction error: {e}")
        
        return text_items
    
    async def _extract_color_scheme(
        self,
        image_path: Path,
        run_id: str
    ) -> Dict[str, Any]:
        """Extract dominant colors from image."""
        color_scheme = {
            "primary": None,
            "secondary": None,
            "background": None,
            "text": None
        }
        
        try:
            from PIL import Image
            import colorsys
            
            with Image.open(image_path) as img:
                # Resize for faster processing
                img.thumbnail((200, 200))
                
                # Get dominant colors
                colors = img.getcolors(maxcolors=256*256*256)
                if colors:
                    # Sort by frequency and get top colors
                    colors.sort(key=lambda x: x[0], reverse=True)
                    top_colors = colors[:5]
                    
                    # Convert to hex
                    hex_colors = []
                    for count, (r, g, b) in top_colors[:5]:
                        hex_colors.append(f"#{r:02x}{g:02x}{b:02x}")
                    
                    if hex_colors:
                        color_scheme["primary"] = hex_colors[0]
                        color_scheme["secondary"] = hex_colors[1] if len(hex_colors) > 1 else None
                        color_scheme["background"] = hex_colors[-1]  # Usually background is most common
        except ImportError:
            logger.debug(f"[{run_id}] PIL not available for color extraction")
        except Exception as e:
            logger.debug(f"[{run_id}] Color extraction error: {e}")
        
        return color_scheme
    
    async def _extract_layout_structure(
        self,
        image_path: Path,
        run_id: str
    ) -> Dict[str, Any]:
        """Analyze layout structure (grid, list, sidebar, etc.)."""
        structure = {
            "type": "unknown",
            "regions": [],
            "has_sidebar": False,
            "has_header": False,
            "has_footer": False
        }
        
        try:
            from PIL import Image
            
            with Image.open(image_path) as img:
                width, height = img.size
                
                # Basic layout detection based on image dimensions and regions
                # Left region (potential sidebar)
                if width > height * 1.2:  # Landscape orientation
                    structure["has_sidebar"] = True
                    structure["type"] = "sidebar_layout"
                else:
                    structure["type"] = "single_column"
                
                # Detect header/footer regions (top/bottom 20%)
                structure["has_header"] = True  # Assume header exists
                structure["has_footer"] = height > 600  # Footer likely if tall
                
                structure["regions"] = [
                    {"name": "header", "y_start": 0, "y_end": int(height * 0.15)},
                    {"name": "content", "y_start": int(height * 0.15), "y_end": int(height * 0.85)},
                    {"name": "footer", "y_start": int(height * 0.85), "y_end": height}
                ]
        except Exception as e:
            logger.debug(f"[{run_id}] Layout structure extraction error: {e}")
        
        return structure
    
    async def _detect_components(
        self,
        image_path: Path,
        run_id: str
    ) -> List[Dict[str, Any]]:
        """Detect UI components (forms, tables, modals, etc.)."""
        components = []
        
        try:
            # Try to detect components based on text patterns
            text_content = await self._extract_text_content(image_path, run_id)
            
            # Look for form indicators
            form_keywords = ['submit', 'save', 'cancel', 'email', 'password', 'username', 'name', 'address']
            if any(keyword in str(text_content).lower() for keyword in form_keywords):
                components.append({
                    "type": "form",
                    "confidence": "medium",
                    "indicators": "Form-related keywords detected"
                })
            
            # Look for table indicators
            table_keywords = ['table', 'row', 'column', 'header', 'data']
            if any(keyword in str(text_content).lower() for keyword in table_keywords):
                components.append({
                    "type": "table",
                    "confidence": "low",
                    "indicators": "Table-related keywords detected"
                })
            
            # Look for modal indicators
            modal_keywords = ['close', 'x', 'cancel', 'dialog']
            if any(keyword in str(text_content).lower() for keyword in modal_keywords):
                components.append({
                    "type": "modal",
                    "confidence": "low",
                    "indicators": "Modal-related keywords detected"
                })
        
        except Exception as e:
            logger.debug(f"[{run_id}] Component detection error: {e}")
        
        return components
    
    async def _identify_workflow_hints(
        self,
        image_path: Path,
        run_id: str
    ) -> List[Dict[str, Any]]:
        """Identify potential workflows and user journeys from image."""
        hints = []
        
        try:
            text_content = await self._extract_text_content(image_path, run_id)
            all_text = " ".join([item.get("text", "") for item in text_content]).lower()
            
            # Detect workflow patterns
            if any(keyword in all_text for keyword in ['login', 'sign in', 'authenticate']):
                hints.append({
                    "workflow": "authentication",
                    "steps": ["Enter credentials", "Submit", "Access dashboard"],
                    "confidence": "high"
                })
            
            if any(keyword in all_text for keyword in ['create', 'new', 'add']):
                hints.append({
                    "workflow": "create_entity",
                    "steps": ["Fill form", "Submit", "View result"],
                    "confidence": "medium"
                })
            
            if any(keyword in all_text for keyword in ['search', 'filter', 'find']):
                hints.append({
                    "workflow": "search_and_filter",
                    "steps": ["Enter search term", "Apply filters", "View results"],
                    "confidence": "medium"
                })
        
        except Exception as e:
            logger.debug(f"[{run_id}] Workflow identification error: {e}")
        
        return hints
    
    async def _check_accessibility(
        self,
        image_path: Path,
        run_id: str
    ) -> List[Dict[str, Any]]:
        """Check for accessibility issues."""
        notes = []
        
        try:
            color_scheme = await self._extract_color_scheme(image_path, run_id)
            
            # Check contrast (basic heuristic)
            if color_scheme.get("primary") and color_scheme.get("background"):
                notes.append({
                    "type": "color_contrast",
                    "severity": "info",
                    "message": "Color contrast should be verified for accessibility"
                })
            
            # Check text readability
            text_content = await self._extract_text_content(image_path, run_id)
            if not text_content:
                notes.append({
                    "type": "text_readability",
                    "severity": "warning",
                    "message": "No text detected - may indicate image-only content without alt text"
                })
        
        except Exception as e:
            logger.debug(f"[{run_id}] Accessibility check error: {e}")
        
        return notes


# Singleton instance
_image_analyzer = None

def get_image_analyzer() -> ImageAnalyzer:
    """Get singleton image analyzer instance."""
    global _image_analyzer
    if _image_analyzer is None:
        _image_analyzer = ImageAnalyzer()
    return _image_analyzer
