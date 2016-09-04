# ajaxautosave
CKEditor ajaxautosave plugin 

Adapted to CKEditor 4.x

Based on ckeditor-ajax-autosave-plugin (https://code.google.com/archive/p/ckeditor-ajax-autosave-plugin), author Jakub Świderski.


The autosaving can be carried out in three ways: 
 * Change counter - Optional trigger which sends data to server only after specified amount changes was made in the editor. 
 * Interval - Optional trigger which sends data to server after specified amount of time.
 * Toolbar button - sends data to server when user click on a button (This is not quite automatic :)). 
  
It is possible to assign keystroke to the button. All of those triggers work independent of each other and without any conflicts.

All communication between plugin and server is made with JSON.

Server must return JSON array like ['status' => 'ok', 'error' => ['message' => 'no error', 'statuscode' => 0] ]

Plugin fires two events: "afterAutosave" (fired right after saving was finished) and "beforeAutosave" (fired right before AJAX request is made) which can be used to execute user specific functions while saving process takes place.

NOTE: It is also possible to use this plugin as simple AJAX manual save.
